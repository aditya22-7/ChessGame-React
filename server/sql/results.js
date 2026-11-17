const { randomUUID } = require("node:crypto");
const { insert, date, number } = require("./database");
const { POLICY, calculate } = require("../ratings/elo");
const { requireThat } = require("../tournaments/errors");
class ResultService {
  async finalize(
    tx,
    {
      matchId = null,
      sessionId = null,
      outcome,
      reason,
      at,
      resultId = randomUUID(),
    },
  ) {
    const c = tx.c;
    const [existing] = await c.execute(
      matchId
        ? "SELECT * FROM game_result WHERE tournament_match_id=?"
        : "SELECT * FROM game_result WHERE game_session_id=?",
      [matchId ?? sessionId],
    );
    if (existing[0]) {
      requireThat(
        existing[0].outcome === outcome &&
          existing[0].reason === reason &&
          require("./database").millis(existing[0].effective_at) === at,
        "RESULT_CONFLICT",
        "Game already has a different result",
      );
      return existing[0].result_id;
    }
    let participants = [],
      moveCount = 0;
    if (sessionId) {
      const [[game]] = await c.execute(
        "SELECT * FROM game_session WHERE game_session_id=? FOR UPDATE",
        [sessionId],
      );
      moveCount = game.current_move_sequence;
      [participants] = await c.execute(
        "SELECT * FROM game_participant WHERE game_session_id=? ORDER BY color",
        [sessionId],
      );
    }
    const recorded = Math.max(await tx.now(), at);
    await insert(c, "game_result", {
      result_id: resultId,
      context: matchId ? "TOURNAMENT" : "QUICK_PLAY",
      tournament_match_id: matchId,
      game_session_id: sessionId,
      outcome,
      reason,
      white_points: outcome === "DRAW" ? 0.5 : outcome === "WHITE_WIN" ? 1 : 0,
      black_points: outcome === "DRAW" ? 0.5 : outcome === "BLACK_WIN" ? 1 : 0,
      effective_at: date(at),
      recorded_at: date(recorded),
      rules_version: "platform-swiss-1",
    });
    const white = participants.find((p) => p.color === "WHITE"),
      black = participants.find((p) => p.color === "BLACK");
    let excluded = null;
    if (!white?.player_id || !black?.player_id)
      excluded = "UNAUTHENTICATED_PLAYERS";
    else if (white.player_id === black.player_id) excluded = "SELF_PLAY";
    else if (
      ![
        "GAME_COMPLETED",
        "RESIGNATION",
        "DRAW_AGREEMENT",
        "MATCH_DEADLINE",
      ].includes(reason)
    )
      excluded = "ADMINISTRATIVE_RESULT";
    else if (moveCount < 2) excluded = "INSUFFICIENT_PLAY";
    const settlement = randomUUID();
    await insert(c, "rating_settlement", {
      settlement_id: settlement,
      result_id: resultId,
      game_session_id: sessionId,
      policy_version: POLICY.version,
      rated: excluded ? 0 : 1,
      exclusion_reason: excluded,
      move_count: moveCount,
    });
    if (!excluded) {
      const profiles = {};
      for (const playerId of [white.player_id, black.player_id].sort()) {
        await c.execute(
          "INSERT IGNORE INTO player_rating(player_id) VALUES (?)",
          [playerId],
        );
        const [[profile]] = await c.execute(
          "SELECT * FROM player_rating WHERE player_id=? FOR UPDATE",
          [playerId],
        );
        profiles[playerId] = profile;
      }
      const w = profiles[white.player_id],
        b = profiles[black.player_id],
        change = calculate(w.rating, b.rating, outcome);
      for (const p of [white, black]) {
        const own = profiles[p.player_id],
          isWhite = p === white;
        await insert(c, "player_rating_change", {
          settlement_id: settlement,
          game_session_id: sessionId,
          participant_id: p.participant_id,
          player_id: p.player_id,
          color: p.color,
          rating_before: own.rating,
          rating_after: isWhite ? change.whiteAfter : change.blackAfter,
          rating_delta: isWhite ? change.whiteDelta : change.blackDelta,
          expected_score: isWhite
            ? change.expectedWhite
            : 1 - change.expectedWhite,
          player_rating_version: number(own.lock_version) + 1,
        });
      }
      for (const p of [white, black]) {
        const own = profiles[p.player_id],
          isWhite = p === white,
          score =
            outcome === "DRAW"
              ? 0.5
              : outcome === (isWhite ? "WHITE_WIN" : "BLACK_WIN")
                ? 1
                : 0;
        await c.execute(
          "UPDATE player_rating SET rating=?,rated_games=rated_games+1,wins=wins+?,draws=draws+?,losses=losses+?,updated_at=?,lock_version=lock_version+1 WHERE player_id=?",
          [
            isWhite ? change.whiteAfter : change.blackAfter,
            score === 1 ? 1 : 0,
            score === 0.5 ? 1 : 0,
            score === 0 ? 1 : 0,
            date(at),
            p.player_id,
          ],
        );
      }
    }
    await c.execute(
      "UPDATE rating_settlement SET status='APPLIED',finalized_at=? WHERE settlement_id=?",
      [date(recorded), settlement],
    );
    if (sessionId)
      await c.execute(
        "UPDATE game_session SET status='FINALIZED',finished_at=? WHERE game_session_id=?",
        [date(at), sessionId],
      );
    if (matchId) {
      await c.execute(
        "UPDATE tournament_match SET status='FINALIZED',finalized_at=? WHERE match_id=?",
        [date(at), matchId],
      );
      await c.execute(
        "UPDATE tournament_round_allocation a JOIN tournament_match_slot s ON s.allocation_id=a.allocation_id SET a.resolution_status='RESOLVED',a.resolved_at=? WHERE s.match_id=?",
        [date(at), matchId],
      );
    }
    if (sessionId && moveCount > 0)
      for (const playerId of new Set(
        participants.map((p) => p.player_id).filter(Boolean),
      )) {
        await c.execute(
          "INSERT INTO player_history(player_history_id,playerID,matches_played,tournaments_played) VALUES (?,?,1,0) ON DUPLICATE KEY UPDATE matches_played=matches_played+1",
          [randomUUID(), playerId],
        );
      }
    return resultId;
  }
}
module.exports = { ResultService };
