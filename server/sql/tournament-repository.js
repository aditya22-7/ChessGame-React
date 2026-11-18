const { insert, json, date, millis, number } = require("./database");
const { requireThat } = require("../tournaments/errors");
const { randomUUID, createHash } = require("node:crypto");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const color = (value) => value.toLowerCase();

async function ratingDecision(c, resultId) {
  const [[s]] = await c.execute(
    "SELECT * FROM rating_settlement WHERE result_id=?",
    [resultId],
  );
  if (!s) return null;
  const [changes] = await c.execute(
    "SELECT * FROM player_rating_change WHERE settlement_id=?",
    [s.settlement_id],
  );
  return {
    policyVersion: s.policy_version,
    rated: Boolean(s.rated),
    excludedReason: s.exclusion_reason,
    ...Object.fromEntries(
      changes.map((r) => [
        color(r.color),
        {
          before: r.rating_before,
          after: r.rating_after,
          delta: r.rating_delta,
          expected: Number(r.expected_score),
        },
      ]),
    ),
  };
}
async function readResult(c, row) {
  if (!row) return null;
  return {
    id: row.result_id,
    outcome: row.outcome,
    reason: row.reason,
    whitePoints: Number(row.white_points),
    blackPoints: Number(row.black_points),
    effectiveAt: millis(row.effective_at),
    recordedAt: millis(row.recorded_at),
    rating: await ratingDecision(c, row.result_id),
  };
}
async function gameData(c, session, match) {
  const [parts] = await c.execute(
    "SELECT * FROM game_participant WHERE game_session_id=?",
    [session.game_session_id],
  );
  const [moves] = await c.execute(
    "SELECT m.*,p.player_id FROM game_move m JOIN game_participant p ON p.participant_id=m.participant_id WHERE m.game_session_id=? ORDER BY move_sequence",
    [session.game_session_id],
  );
  const [receipts] = await c.execute(
    "SELECT r.*,p.player_id FROM game_command_receipt r JOIN game_participant p ON p.participant_id=r.participant_id WHERE r.game_session_id=?",
    [session.game_session_id],
  );
  const decode = (square) => ({
    row: Number(square[1]) - 1,
    col: square.charCodeAt(0) - 97,
  });
  const game = {
    id: session.game_session_id,
    ruleset: session.engine_ruleset_version,
    status: session.status,
    moves: moves.map((m) => ({
      from: decode(m.from_square),
      to: decode(m.to_square),
      playerId: m.player_id,
      acceptedAt: millis(m.accepted_at),
    })),
    commands: Object.fromEntries(
      receipts.map((r) => [
        `${r.player_id}:${r.command_id}`,
        { fingerprint: r.request_hash, response: json(r.response_payload) },
      ]),
    ),
    disconnects: { white: null, black: null },
    drawOffer: null,
  };
  for (const p of parts) {
    const side = color(p.color);
    if (match)
      match.attendance[side] = {
        joinedAt: millis(p.first_joined_at),
        connected: Boolean(p.presence_epoch) && p.disconnected_at === null,
      };
    if (p.disconnected_at)
      game.disconnects[side] = {
        disconnectedAt: millis(p.disconnected_at),
        deadlineAt: millis(p.reconnect_deadline_at),
        cause: p.disconnect_cause,
      };
    if (session.draw_offer_participant_id === p.participant_id)
      game.drawOffer = side;
  }
  return { game, parts };
}
class TournamentRepository {
  async load(c, id, { lock = false } = {}) {
    requireThat(
      typeof id === "string" && /^[\w-]{1,36}$/.test(id),
      "NOT_FOUND",
      "Tournament not found",
      404,
    );
    const [[row]] = await c.execute(
      "SELECT * FROM tournament WHERE tournament_id=?" +
        (lock ? " FOR UPDATE" : ""),
      [id],
    );
    requireThat(row, "NOT_FOUND", "Tournament not found", 404);
    const [[cfg]] = await c.execute(
      "SELECT * FROM tournament_configuration WHERE tournament_id=?",
      [id],
    );
    requireThat(cfg, "NOT_CONFIGURED", "Tournament is not configured", 409);
    const [entrants] = await c.execute(
      "SELECT e.*,r.player_id,p.username FROM tournament_entrant e JOIN tournament_player_registration r ON r.entrant_id=e.entrant_id JOIN player p ON p.player_id=r.player_id WHERE e.tournament_id=? ORDER BY e.registered_at,e.entrant_id",
      [id],
    );
    const t = {
      id,
      name: row.tour_name,
      format: cfg.format_code,
      status: row.status,
      totalRounds: cfg.total_rounds,
      provisionKey: row.provision_key,
      registrationClosesAt: millis(row.registration_closes_at),
      firstRoundStartsAt: millis(row.tour_start_day),
      matchDurationMs: number(cfg.match_duration_ms),
      interRoundGapMs: number(cfg.inter_round_gap_ms),
      maxEntrants: cfg.maximum_entrants,
      reconnectGraceMs: number(cfg.reconnect_grace_ms),
      createdAt: millis(row.created_at),
      completedAt: millis(row.completed_at),
      version: number(row.lock_version),
      competitionVersion: number(row.competition_version),
      pairingSeed: cfg.pairing_random_seed,
      rulesVersion: "platform-swiss-1",
      tiebreakVersion: cfg.tiebreak_policy_version,
      entrants: entrants.map((e) => ({
        id: e.entrant_id,
        playerId: e.player_id,
        username: e.username,
        status: e.registration_status,
        seed: e.seed_number,
        registeredAt: millis(e.registered_at),
        withdrawnAt: millis(e.withdrawn_at),
      })),
      rounds: [],
    };
    if (row.failure_code) t.failure = { code: row.failure_code };
    const [rounds] = await c.execute(
      "SELECT * FROM tournament_round WHERE tournament_id=? ORDER BY round_number",
      [id],
    );
    for (const r of rounds) {
      const round = {
        id: r.round_id,
        number: r.round_number,
        status: r.status,
        startsAt: millis(r.scheduled_start_at),
        endsAt: millis(r.hard_deadline_at),
        startedAt: millis(r.actual_started_at),
        completedAt: millis(r.completed_at),
        pairingsPublishedAt: millis(r.pairings_published_at),
        pairingAlgorithmVersion: r.pairing_algorithm_version,
        pairingInputHash: r.pairing_input_hash,
        matches: [],
        awards: [],
      };
      if (r.failure_code)
        round.failure = { code: r.failure_code, ...json(r.failure_details) };
      const [awards] = await c.execute(
        "SELECT * FROM tournament_round_allocation WHERE round_id=? AND allocation_type<>'MATCH'",
        [round.id],
      );
      round.awards = awards.map((a) => ({
        entrantId: a.entrant_id,
        points: Number(a.awarded_points),
        type:
          a.allocation_type === "WITHDRAWN"
            ? "WITHDRAWN_BYE"
            : a.allocation_type,
      }));
      const [matches] = await c.execute(
        "SELECT * FROM tournament_match WHERE round_id=? ORDER BY board_number",
        [round.id],
      );
      for (const m of matches) {
        const [slots] = await c.execute(
          "SELECT * FROM tournament_match_slot WHERE match_id=?",
          [m.match_id],
        );
        const match = {
          id: m.match_id,
          boardNumber: m.board_number,
          status: m.status,
          startsAt: round.startsAt,
          deadlineAt: round.endsAt,
          startedAt: millis(m.actual_started_at),
          result: null,
          attendance: {
            white: { joinedAt: null, connected: false },
            black: { joinedAt: null, connected: false },
          },
        };
        for (const s of slots)
          match[color(s.color) + "EntrantId"] = s.entrant_id;
        const [[session]] = await c.execute(
          "SELECT * FROM game_session WHERE tournament_match_id=?",
          [m.match_id],
        );
        if (session) match.game = (await gameData(c, session, match)).game;
        const [[result]] = await c.execute(
          "SELECT * FROM game_result WHERE tournament_match_id=?",
          [m.match_id],
        );
        match.result = await readResult(c, result);
        round.matches.push(match);
      }
      t.rounds.push(round);
    }
    return t;
  }
  async listIds(c) {
    const [rows] = await c.query(
      "SELECT tournament_id FROM tournament_configuration ORDER BY tournament_id",
    );
    return rows.map((r) => r.tournament_id);
  }
  async create(c, t) {
    const description = "Individual chess competition";
    await c.execute(
      "INSERT IGNORE INTO tourtype(tourType_id,_name,_description) VALUES (?,?,?)",
      [randomUUID(), "INDIVIDUAL", description],
    );
    const [[type]] = await c.execute(
      "SELECT tourType_id FROM tourtype WHERE _name=? AND _description=?",
      ["INDIVIDUAL", description],
    );
    await insert(c, "tournament", {
      tournament_id: t.id,
      tourtypeID: type.tourType_id,
      tour_name: t.name,
      tour_version: 1,
      number_of_teams: 0,
      number_of_players: 0,
      tour_start_day: date(t.firstRoundStartsAt),
      tour_end_day: date(t.rounds.at(-1).endsAt),
      registration_opens_at: date(t.createdAt),
      registration_closes_at: date(t.registrationClosesAt),
      provision_key: t.provisionKey ?? null,
      created_at: date(t.createdAt),
    });
    const parameters = JSON.stringify({ rulesVersion: t.rulesVersion });
    await insert(c, "tournament_configuration", {
      tournament_id: t.id,
      format_code: t.format,
      format_version: "custom-swiss-1",
      total_rounds: t.totalRounds,
      maximum_entrants: t.maxEntrants,
      match_duration_ms: t.matchDurationMs,
      inter_round_gap_ms: t.interRoundGapMs,
      reconnect_grace_ms: t.reconnectGraceMs,
      pairing_random_seed: t.pairingSeed,
      tiebreak_policy_version: t.tiebreakVersion,
      policy_parameters: parameters,
      configuration_hash: hash(JSON.stringify(t)),
    });
    for (const r of t.rounds)
      await insert(c, "tournament_round", {
        round_id: r.id,
        tournament_id: t.id,
        round_number: r.number,
        scheduled_start_at: date(r.startsAt),
        hard_deadline_at: date(r.endsAt),
      });
    await c.execute(
      "UPDATE tournament_configuration SET frozen_at=? WHERE tournament_id=?",
      [date(t.createdAt), t.id],
    );
    await c.execute(
      "UPDATE tournament SET status='REGISTRATION_OPEN' WHERE tournament_id=?",
      [t.id],
    );
  }
}
module.exports = {
  TournamentRepository,
  gameData,
  readResult,
  ratingDecision,
  hash,
};
