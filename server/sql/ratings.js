const { POLICY } = require("../ratings/elo");
const { requireThat } = require("../tournaments/errors");
const { millis } = require("./database");
class SqlRatings {
  constructor(uow) {
    this.uow = uow;
  }
  get(playerId) {
    return this.uow.run(
      async (tx) => {
        const [[p]] = await tx.c.execute(
          "SELECT * FROM player_rating WHERE player_id=?",
          [playerId],
        );
        return {
          playerId,
          rating: p?.rating ?? POLICY.initialRating,
          ratedGames: p?.rated_games ?? 0,
          wins: p?.wins ?? 0,
          draws: p?.draws ?? 0,
          losses: p?.losses ?? 0,
          updatedAt: millis(p?.updated_at),
          policy: POLICY,
        };
      },
      { readOnly: true },
    );
  }
  history(playerId, { limit = 20, offset = 0 } = {}) {
    requireThat(
      Number.isInteger(limit) &&
        limit > 0 &&
        limit <= 100 &&
        Number.isSafeInteger(offset) &&
        offset >= 0,
      "INVALID_PAGINATION",
      "Invalid pagination",
      400,
    );
    return this.uow.run(
      async (tx) => {
        const [[count]] = await tx.c.execute(
          "SELECT COUNT(*) total FROM player_rating_change WHERE player_id=?",
          [playerId],
        );
        const [rows] = await tx.c.query(
          `SELECT ch.*,r.reason,r.outcome,r.effective_at,m.tournament_id,m.match_id,t.tour_name,other.player_id opponent_id FROM player_rating_change ch JOIN rating_settlement s ON s.settlement_id=ch.settlement_id JOIN game_result r ON r.result_id=s.result_id LEFT JOIN tournament_match m ON m.match_id=r.tournament_match_id LEFT JOIN tournament t ON t.tournament_id=m.tournament_id JOIN game_participant other ON other.game_session_id=ch.game_session_id AND other.color<>ch.color WHERE ch.player_id=? ORDER BY ch.player_rating_version DESC LIMIT ? OFFSET ?`,
          [playerId, limit, offset],
        );
        return {
          total: Number(count.total),
          limit,
          offset,
          games: rows.map((r) => ({
            gameId: r.game_session_id,
            tournamentId: r.tournament_id,
            tournamentName: r.tour_name,
            matchId: r.match_id,
            opponentId: r.opponent_id,
            side: r.color.toLowerCase(),
            score:
              r.outcome === "DRAW"
                ? 0.5
                : r.outcome ===
                    (r.color === "WHITE" ? "WHITE_WIN" : "BLACK_WIN")
                  ? 1
                  : 0,
            reason: r.reason,
            completedAt: millis(r.effective_at),
            policyVersion: POLICY.version,
            before: r.rating_before,
            after: r.rating_after,
            delta: r.rating_delta,
            expected: Number(r.expected_score),
          })),
        };
      },
      { snapshot: true },
    );
  }
}
module.exports = { SqlRatings };
