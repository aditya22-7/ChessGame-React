const { randomUUID } = require("node:crypto");
const { insert, date } = require("./database");
const { hash, readResult } = require("./tournament-repository");
const { ResultService } = require("./results");
const { standings } = require("../tournaments/standings");
const square = (p) => String.fromCharCode(97 + p.col) + (p.row + 1);

/** Applies one planned aggregate in FK/trigger order. Caller holds tournament row lock. */
class TournamentWriter {
  constructor(epoch) {
    this.epoch = epoch;
    this.results = new ResultService();
  }
  async save(tx, before, t, events) {
    const c = tx.c;
    for (const e of t.entrants) {
      const old = before.entrants.find((x) => x.id === e.id);
      if (!old) {
        await insert(c, "tournament_entrant", {
          entrant_id: e.id,
          tournament_id: t.id,
          registered_at: date(e.registeredAt),
        });
        await insert(c, "tournament_player_registration", {
          entrant_id: e.id,
          tournament_id: t.id,
          player_id: e.playerId,
        });
      }
      if (!old || old.status !== e.status || old.seed !== e.seed)
        await c.execute(
          "UPDATE tournament_entrant SET registration_status=?,withdrawn_at=?,seed_number=? WHERE entrant_id=?",
          [e.status, date(e.withdrawnAt), e.seed, e.id],
        );
    }
    // READY precedes publication; IN_PROGRESS precedes starting a fixture.
    if (
      before.status === "REGISTRATION_OPEN" &&
      t.status !== "REGISTRATION_OPEN" &&
      t.entrants.some((e) => e.seed)
    )
      await c.execute(
        "UPDATE tournament SET status='READY' WHERE tournament_id=?",
        [t.id],
      );
    let playing = before.status === "IN_PROGRESS";
    for (const r of t.rounds) {
      const old = before.rounds.find((x) => x.id === r.id);
      if (old.status === "SCHEDULED" && r.pairingsPublishedAt != null) {
        for (const a of r.awards)
          await insert(c, "tournament_round_allocation", {
            allocation_id: randomUUID(),
            tournament_id: t.id,
            round_id: r.id,
            entrant_id: a.entrantId,
            allocation_type: a.type === "WITHDRAWN_BYE" ? "WITHDRAWN" : a.type,
            awarded_points: a.points,
            award_reason: a.type,
          });
        for (const m of r.matches) {
          await insert(c, "tournament_match", {
            match_id: m.id,
            tournament_id: t.id,
            round_id: r.id,
            board_number: m.boardNumber,
          });
          const slots = [];
          for (const side of ["white", "black"]) {
            const entrantId = m[side + "EntrantId"],
              allocation = randomUUID(),
              slot = randomUUID();
            await insert(c, "tournament_round_allocation", {
              allocation_id: allocation,
              tournament_id: t.id,
              round_id: r.id,
              entrant_id: entrantId,
              allocation_type: "MATCH",
            });
            await insert(c, "tournament_match_slot", {
              slot_id: slot,
              match_id: m.id,
              tournament_id: t.id,
              round_id: r.id,
              allocation_id: allocation,
              entrant_id: entrantId,
              color: side.toUpperCase(),
            });
            slots.push({ side, slot, entrantId });
          }
          const ids = [m.whiteEntrantId, m.blackEntrantId].sort();
          await insert(c, "tournament_opponent_pair", {
            tournament_id: t.id,
            lower_entrant_id: ids[0],
            higher_entrant_id: ids[1],
            match_id: m.id,
          });
          await c.execute(
            "UPDATE tournament_match SET status='WAITING' WHERE match_id=?",
            [m.id],
          );
          await insert(c, "game_session", {
            game_session_id: m.game.id,
            origin: "TOURNAMENT",
            tournament_match_id: m.id,
            engine_ruleset_version: m.game.ruleset,
          });
          for (const s of slots)
            await insert(c, "game_participant", {
              participant_id: randomUUID(),
              game_session_id: m.game.id,
              color: s.side.toUpperCase(),
              player_id: t.entrants.find((e) => e.id === s.entrantId).playerId,
              tournament_match_id: m.id,
              entrant_id: s.entrantId,
              slot_id: s.slot,
            });
        }
        await c.execute(
          "UPDATE tournament_round SET status='PAIRED',pairings_published_at=?,pairing_algorithm_version=?,pairing_input_hash=?,pairing_input_version=? WHERE round_id=?",
          [
            date(r.pairingsPublishedAt),
            r.pairingAlgorithmVersion,
            r.pairingInputHash,
            t.version,
            r.id,
          ],
        );
      }
      if (r.startedAt != null && old.startedAt == null) {
        if (!playing) {
          await c.execute(
            "UPDATE tournament SET status='IN_PROGRESS' WHERE tournament_id=?",
            [t.id],
          );
          playing = true;
        }
        await c.execute(
          "UPDATE tournament_round SET status='IN_PROGRESS',actual_started_at=? WHERE round_id=?",
          [date(r.startedAt), r.id],
        );
        if (r.number === 1)
          for (const e of t.entrants.filter((e) => e.seed != null)) {
            await c.execute(
              "UPDATE tournament_entrant SET first_participated_at=? WHERE entrant_id=? AND first_participated_at IS NULL",
              [date(r.startedAt), e.id],
            );
            await c.execute(
              "INSERT INTO player_history(player_history_id,playerID,matches_played,tournaments_played) VALUES (?,?,0,1) ON DUPLICATE KEY UPDATE tournaments_played=tournaments_played+1",
              [randomUUID(), e.playerId],
            );
          }
      }
      for (const m of r.matches) {
        const previous = old.matches.find((x) => x.id === m.id);
        if (previous?.result) continue;
        const [parts] = await c.execute(
          "SELECT * FROM game_participant WHERE game_session_id=?",
          [m.game.id],
        );
        if (m.startedAt != null && previous?.startedAt == null) {
          await c.execute(
            "UPDATE tournament_match SET status='IN_PROGRESS',actual_started_at=? WHERE match_id=?",
            [date(m.startedAt), m.id],
          );
          await c.execute(
            "UPDATE game_session SET status='IN_PROGRESS',started_at=? WHERE game_session_id=?",
            [date(m.startedAt), m.game.id],
          );
        }
        for (const p of parts) {
          const side = p.color.toLowerCase(),
            attendance = m.attendance[side],
            d = m.game.disconnects[side];
          await c.execute(
            "UPDATE game_participant SET first_joined_at=?,last_seen_at=?,disconnected_at=?,reconnect_deadline_at=?,disconnect_cause=?,presence_epoch=?,connection_generation=connection_generation+1 WHERE participant_id=?",
            [
              date(attendance.joinedAt),
              attendance.connected ? date(await tx.now()) : p.last_seen_at,
              date(d?.disconnectedAt),
              date(d?.deadlineAt),
              d?.cause ?? null,
              attendance.connected ? this.epoch : null,
              p.participant_id,
            ],
          );
        }
        for (
          let i = previous?.game.moves.length ?? 0;
          i < m.game.moves.length;
          i++
        ) {
          const move = m.game.moves[i],
            p = parts.find((p) => p.color === (i % 2 ? "BLACK" : "WHITE"));
          await insert(c, "game_move", {
            move_id: randomUUID(),
            game_session_id: m.game.id,
            move_sequence: i + 1,
            participant_id: p.participant_id,
            from_square: square(move.from),
            to_square: square(move.to),
            accepted_at: date(move.acceptedAt),
          });
          await c.execute(
            "UPDATE game_session SET current_move_sequence=?,side_to_move=?,draw_offer_participant_id=NULL,draw_offered_at=NULL WHERE game_session_id=?",
            [i + 1, i % 2 ? "WHITE" : "BLACK", m.game.id],
          );
        }
        const offer = parts.find(
          (p) => p.color.toLowerCase() === m.game.drawOffer,
        );
        await c.execute(
          "UPDATE game_session SET draw_offer_participant_id=?,draw_offered_at=? WHERE game_session_id=?",
          [
            offer?.participant_id ?? null,
            offer ? date(await tx.now()) : null,
            m.game.id,
          ],
        );
        if (m.result) {
          await this.results.finalize(tx, {
            matchId: m.id,
            sessionId: m.game.id,
            outcome: m.result.outcome,
            reason: m.result.reason,
            at: m.result.effectiveAt,
            resultId: m.result.id,
          });
          const [[row]] = await c.execute(
            "SELECT * FROM game_result WHERE result_id=?",
            [m.result.id],
          );
          m.result = await readResult(c, row);
        }
        for (const [key, receipt] of Object.entries(m.game.commands))
          if (!previous?.game.commands[key]) {
            const separator = key.indexOf(":"),
              playerId = key.slice(0, separator),
              p = parts.find((p) => p.player_id === playerId);
            if (receipt.response.result && m.result)
              receipt.response.result = m.result;
            const command = JSON.parse(receipt.fingerprint);
            await insert(c, "game_command_receipt", {
              game_session_id: m.game.id,
              participant_id: p.participant_id,
              command_id: key.slice(separator + 1),
              request_hash: hash(receipt.fingerprint),
              accepted_move_sequence:
                command.type === "MOVE" ? receipt.response.moveSequence : null,
              response_payload: JSON.stringify(receipt.response),
            });
          }
      }
      for (const a of r.awards) {
        const type = a.type === "WITHDRAWN_BYE" ? "WITHDRAWN" : a.type;
        await c.execute(
          "UPDATE tournament_round_allocation SET allocation_type=?,awarded_points=?,award_reason=? WHERE round_id=? AND entrant_id=? AND resolution_status='PENDING' AND allocation_type<>'MATCH'",
          [type, a.points, a.type, r.id, a.entrantId],
        );
      }
      if (r.startedAt != null)
        await c.execute(
          "UPDATE tournament_round_allocation SET resolution_status='RESOLVED',resolved_at=? WHERE round_id=? AND allocation_type<>'MATCH' AND resolution_status='PENDING'",
          [date(r.startedAt), r.id],
        );
      if (r.status === "COMPLETED" && old.status !== "COMPLETED")
        await c.execute(
          "UPDATE tournament_round SET status='COMPLETED',completed_at=? WHERE round_id=?",
          [date(r.completedAt), r.id],
        );
      if (r.status === "FAILED" && old.status !== "FAILED")
        await c.execute(
          "UPDATE tournament_round SET status='FAILED',failure_code=?,failure_details=? WHERE round_id=?",
          [r.failure.code, JSON.stringify(r.failure), r.id],
        );
    }
    if (t.status === "COMPLETED" && before.status !== "COMPLETED")
      for (const s of standings(t).filter((s) => s.seed != null))
        await insert(c, "tournament_final_standing", {
          tournament_id: t.id,
          entrant_id: s.entrantId,
          final_rank: s.rank,
          score: s.score,
          buchholz: s.buchholz,
          sonneborn_berger: s.sonnebornBerger,
          played_wins: s.playedWins,
          tiebreak_policy_version: t.tiebreakVersion,
          source_competition_version: t.version,
          finalized_at: date(t.completedAt),
        });
    await c.execute(
      "UPDATE tournament SET status=?,completed_at=?,failure_code=?,lock_version=?,competition_version=?,number_of_players=? WHERE tournament_id=?",
      [
        t.status,
        date(t.completedAt),
        t.failure?.code ?? null,
        t.version,
        t.version,
        t.entrants.filter((e) => e.status === "REGISTERED").length,
        t.id,
      ],
    );
    for (const event of events) {
      if (event.payload.result)
        event.payload.result = t.rounds
          .flatMap((r) => r.matches)
          .find((m) => m.id === event.payload.matchId).result;
      await insert(c, "outbox_event", {
        event_id: randomUUID(),
        tournament_id: t.id,
        event_type: event.type,
        aggregate_version: event.version,
        payload: JSON.stringify(event.payload),
      });
    }
  }
}
module.exports = { TournamentWriter };
