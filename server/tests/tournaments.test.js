const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { MemoryStore } = require('../persistence/store');
const { TournamentService } = require('../tournaments/service');
const { SwissFormat, allowedColor } = require('../tournaments/formats/swiss');
const { standings } = require('../tournaments/standings');

test('registration is unique, permanent withdrawal and capacity are enforced', () => {
  const f = fixture(2, 1, { config: { maxEntrants: 2 } });
  const old = f.service.register(f.tournament.id, 'p0');
  assert.equal(f.raw().entrants.length, 2);
  assert.equal(old.playerId, 'p0');
  assert.throws(() => f.service.register(f.tournament.id, 'p2'), { code: 'TOURNAMENT_FULL' });
  f.service.withdraw(f.tournament.id, 'p0');
  assert.throws(() => f.service.register(f.tournament.id, 'p0'), { code: 'WITHDRAWN' });
  assert.equal(f.service.register(f.tournament.id, 'p2').playerId, 'p2');
});
test('schedule validation, minimum field, unsupported format', () => {
  const service = new TournamentService({ store: new MemoryStore(), clock: () => 1000 });
  assert.throws(() => service.create({}), { code: 'INVALID_CONFIG' });
  assert.throws(() => fixture(2, 1, { config: { interRoundGapMs: 0 } }), { code: 'INVALID_SCHEDULE' });
  assert.throws(() => fixture(2, 1, { config: { format: 'OTHER' } }), { code: 'UNSUPPORTED_FORMAT' });
  const f = fixture(1, 1); f.prepare();
  assert.equal(f.raw().status, 'FAILED');
  assert.equal(f.raw().failure.code, 'INSUFFICIENT_FIELD');
});
test('random persisted seeding uses split halves in first round', () => {
  const f = fixture(); const round = f.prepare();
  const seed = id => f.raw().entrants.find(e => e.id === id).seed;
  for (const m of round.matches) assert.equal(Math.abs(seed(m.whiteEntrantId) - seed(m.blackEntrantId)), 4);
  assert.throws(() => f.service.register(f.tournament.id, 'late'), { code: 'REGISTRATION_CLOSED' });
});
test('fixed concurrent round starts and deadline draws advance without shifting times', () => {
  const f = fixture(); const r = f.start();
  assert.equal(r.matches.length, 4);
  assert.ok(r.matches.every(m => m.status === 'IN_PROGRESS'));
  f.setTime(13000); f.service.tick();
  assert.ok(f.raw().rounds[0].matches.every(m => m.result.reason === 'MATCH_DEADLINE'));
  assert.equal(f.raw().rounds[1].status, 'PAIRED');
  assert.equal(f.raw().rounds[1].startsAt, 14000);
  assert.ok(f.service.standings(f.tournament.id).every(e => e.score === 0.5));
});
test('single absence loses, double absence draws, late joining cannot reverse a result', () => {
  const f = fixture(4, 1); const r = f.prepare();
  const m = r.matches[0];
  f.service.join(f.tournament.id, m.id, f.owner(m.whiteEntrantId), 'present');
  f.setTime(3000); f.service.tick();
  const matches = f.raw().rounds[0].matches;
  assert.equal(matches[0].result.outcome, 'WHITE_WIN');
  assert.equal(matches[0].result.reason, 'SINGLE_NO_SHOW');
  assert.equal(matches[1].result.reason, 'DOUBLE_NO_SHOW');
  assert.equal(f.raw().status, 'COMPLETED');
  assert.throws(() => f.service.join(f.tournament.id, m.id, f.owner(m.blackEntrantId), 'late'), { code: 'MATCH_OVER' });
});
test('withdrawal after published pairing forfeits only unfinished match', () => {
  const f = fixture(4, 2); const r = f.prepare(), m = r.matches[0];
  f.service.withdraw(f.tournament.id, f.owner(m.whiteEntrantId));
  assert.equal(f.raw().rounds[0].matches[0].result.reason, 'WITHDRAWAL');
  assert.equal(f.raw().rounds[0].matches[0].result.blackPoints, 1);
  f.setTime(3000); f.service.tick();
  assert.ok(f.raw().rounds[1].matches.every(m => m.whiteEntrantId !== r.matches[0].whiteEntrantId && m.blackEntrantId !== r.matches[0].whiteEntrantId));
});
test('bye score is awarded at round start and withdrawal cancels an upcoming bye', () => {
  const f = fixture(5, 2); const r = f.prepare();
  assert.equal(r.awards.length, 1);
  assert.equal(f.service.standings(f.tournament.id).reduce((n, e) => n + e.score, 0), 0);
  const byeId = r.awards[0].entrantId;
  f.service.withdraw(f.tournament.id, f.owner(byeId));
  f.setTime(3000); f.service.tick();
  assert.equal(f.service.standings(f.tournament.id).find(e => e.entrantId === byeId).score, 0);
});
test('reconnection before expiry preserves game; multiple tabs do not cause false disconnect', () => {
  const f = fixture(2, 1), m = f.start().matches[0], p = f.owner(m.whiteEntrantId);
  f.service.join(f.tournament.id, m.id, p, 'second-tab');
  f.service.disconnect(p + ':1');
  assert.equal(f.raw().rounds[0].matches[0].game.disconnects.white, null);
  f.service.disconnect('second-tab');
  f.setTime(3500);
  f.service.join(f.tournament.id, m.id, p, 'returned');
  f.setTime(4500); f.service.tick();
  assert.equal(f.raw().rounds[0].matches[0].result, null);
});
test('single reconnect expiry forfeits, both disconnected draw after both windows expire', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.service.disconnect(f.owner(m.whiteEntrantId) + ':1');
  f.setTime(4000); f.service.tick();
  assert.equal(f.raw().rounds[0].matches[0].result.reason, 'RECONNECT_EXPIRED');
  assert.equal(f.raw().rounds[0].matches[0].result.outcome, 'BLACK_WIN');
  const g = fixture(2, 1), n = g.start().matches[0];
  g.service.disconnect(g.owner(n.whiteEntrantId) + ':1');
  g.setTime(3500); g.service.disconnect(g.owner(n.blackEntrantId) + ':1');
  g.setTime(4000); g.service.tick();
  assert.equal(g.raw().rounds[0].matches[0].result, null);
  g.setTime(4500); g.service.tick();
  assert.equal(g.raw().rounds[0].matches[0].result.reason, 'DOUBLE_DISCONNECT');
});
test('opponent can return during their window after the other window expires and win', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.service.disconnect(f.owner(m.whiteEntrantId) + ':1');
  f.setTime(3500); f.service.disconnect(f.owner(m.blackEntrantId) + ':1');
  f.setTime(4200); f.service.join(f.tournament.id, m.id, f.owner(m.blackEntrantId), 'back');
  assert.equal(f.raw().rounds[0].matches[0].result.outcome, 'BLACK_WIN');
});
test('hard deadline wins at equal timestamp and denies a late move', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.setTime(12000); f.service.disconnect(f.owner(m.whiteEntrantId) + ':1');
  f.setTime(13000);
  assert.throws(() => f.service.command(f.tournament.id, m.id, f.owner(m.whiteEntrantId), {
    commandId: 'late', type: 'MOVE', expectedMoveSequence: 0, from: { row: 1, col: 4 }, to: { row: 3, col: 4 },
  }), { code: 'MATCH_NOT_PLAYING' });
  assert.equal(f.raw().rounds[0].matches[0].result.reason, 'MATCH_DEADLINE');
});
test('authoritative moves validate membership, turn, sequence and command idempotency', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  const w = f.owner(m.whiteEntrantId), b = f.owner(m.blackEntrantId);
  const cmd = { commandId: 'move-1', type: 'MOVE', expectedMoveSequence: 0,
    from: { row: 1, col: 4 }, to: { row: 3, col: 4 } };
  assert.throws(() => f.service.command(f.tournament.id, m.id, 'intruder', cmd), { code: 'FORBIDDEN' });
  assert.throws(() => f.service.command(f.tournament.id, m.id, b, cmd), { code: 'NOT_YOUR_TURN' });
  assert.throws(() => f.service.command(f.tournament.id, m.id, w, { ...cmd, to: { row: 7, col: 7 } }), { code: 'ILLEGAL_MOVE' });
  const response = f.service.command(f.tournament.id, m.id, w, cmd);
  assert.equal(response.moveSequence, 1);
  assert.deepEqual(f.service.command(f.tournament.id, m.id, w, cmd), response);
  assert.throws(() => f.service.command(f.tournament.id, m.id, w, { ...cmd, type: 'RESIGN' }), { code: 'COMMAND_CONFLICT' });
  assert.throws(() => f.service.command(f.tournament.id, m.id, b, { ...cmd, commandId: 'stale' }), { code: 'STALE_MOVE' });
  assert.equal(f.raw().rounds[0].matches[0].game.moves.length, 1);
});
test('resignation and draw acceptance finalize exactly once', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  const w = f.owner(m.whiteEntrantId), b = f.owner(m.blackEntrantId);
  f.service.command(f.tournament.id, m.id, w, { commandId: 'offer', type: 'OFFER_DRAW' });
  assert.throws(() => f.service.command(f.tournament.id, m.id, w, { commandId: 'self', type: 'ACCEPT_DRAW' }), { code: 'NO_DRAW_OFFER' });
  const cmd = { commandId: 'accept', type: 'ACCEPT_DRAW' };
  const result = f.service.command(f.tournament.id, m.id, b, cmd);
  assert.equal(result.result.reason, 'DRAW_AGREEMENT');
  assert.deepEqual(f.service.command(f.tournament.id, m.id, b, cmd), result);
  assert.equal(f.raw().status, 'COMPLETED');
});
test('full multi-round Swiss simulation has no repeats, duplicate allocations or third same color', () => {
  for (const n of [5, 8, 16]) {
    const f = fixture(n, 3); f.prepare();
    for (let r = 1; r <= 3; r++) {
      const round = f.joinRound(r);
      assert.equal(round.status, 'PAIRED');
      f.setTime(round.startsAt); f.service.tick();
      f.setTime(round.endsAt); f.service.tick();
    }
    const t = f.raw(); assert.equal(t.status, 'COMPLETED');
    const seen = new Set(), colors = new Map();
    for (const r of t.rounds) {
      const allocations = new Set();
      for (const m of r.matches) {
        const pair = [m.whiteEntrantId, m.blackEntrantId].sort().join(':');
        assert.ok(!seen.has(pair)); seen.add(pair);
        for (const side of ['white', 'black']) {
          const e = m[side + 'EntrantId']; assert.ok(!allocations.has(e)); allocations.add(e);
          const history = colors.get(e) ?? [];
          assert.ok(allowedColor({ colors: history }, side)); history.push(side); colors.set(e, history);
        }
      }
      for (const a of r.awards) { assert.ok(!allocations.has(a.entrantId)); allocations.add(a.entrantId); }
      assert.equal(allocations.size, n);
    }
  }
});
test('impossible pairing and exhausted search are explicit errors', () => {
  const p = (id, seed) => ({ id, seed, score: 0, opponents: [], colors: [], fullPointUnplayed: false });
  const a = p('a', 1), b = p('b', 2); a.opponents = ['b'];
  assert.throws(() => new SwissFormat().generateRound([a, b]), { code: 'NO_VALID_PAIRING' });
  assert.throws(() => new SwissFormat({ searchLimit: 0 }).generateRound([p('a', 1), b]), { code: 'SEARCH_LIMIT_REACHED' });
});
test('outbox retry retains pending events and detached reads cannot mutate storage', () => {
  const f = fixture(2, 1);
  const copy = f.raw(); copy.name = 'changed'; assert.notEqual(f.raw().name, 'changed');
  assert.throws(() => f.service.flushEvents(() => { throw new Error('delivery failed'); }));
  assert.ok(f.store.read(s => s.outbox.some(e => !e.delivered)));
  const ids = []; f.service.flushEvents(e => ids.push(e.id));
  assert.equal(new Set(ids).size, ids.length);
  f.service.flushEvents(() => assert.fail('Duplicate delivered event'));
});
test('tiebreaks cap unplayed dummy score and preserve shared ranks', () => {
  const f = fixture(2, 1); f.prepare(); f.setTime(3000); f.service.tick();
  const rows = standings(f.raw());
  assert.equal(rows[0].score, 0.5); assert.equal(rows[0].buchholz, 0.5);
  assert.equal(rows[0].sonnebornBerger, 0.25);
  assert.equal(rows[0].rank, rows[1].rank);
});
test('Buchholz and Sonneborn–Berger account for played opposition and capped forfeits', () => {
  const match = (whiteEntrantId, blackEntrantId, whitePoints, blackPoints, played, reason) => ({
    whiteEntrantId, blackEntrantId, startedAt: played ? 1 : null,
    result: { whitePoints, blackPoints, reason },
  });
  const tournament = { totalRounds: 2,
    entrants: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, playerId: id, seed: i + 1, status: 'REGISTERED' })),
    rounds: [
      { number: 1, startedAt: 1, awards: [], matches: [match('a', 'b', 1, 0, true, 'GAME_COMPLETED'), match('c', 'd', 0.5, 0.5, true, 'DRAW_AGREEMENT')] },
      { number: 2, startedAt: 2, awards: [], matches: [match('a', 'c', 0, 1, false, 'WITHDRAWAL'), match('b', 'd', 1, 0, true, 'GAME_COMPLETED')] },
    ],
  };
  const rows = Object.fromEntries(standings(tournament).map(r => [r.entrantId, r]));
  assert.equal(rows.a.buchholz, 2); assert.equal(rows.a.sonnebornBerger, 1);
  assert.equal(rows.b.buchholz, 1.5); assert.equal(rows.b.sonnebornBerger, 0.5);
  assert.equal(rows.c.buchholz, 1.5); assert.equal(rows.c.sonnebornBerger, 1.25);
  assert.equal(rows.c.playedWins, 0);
});
test('odd first round removes the lowest seed before split-half pairing', () => {
  const f = fixture(5, 2), r = f.prepare();
  const seed = id => f.raw().entrants.find(e => e.id === id).seed;
  assert.equal(seed(r.awards[0].entrantId), 5);
  for (const m of r.matches) assert.equal(Math.abs(seed(m.whiteEntrantId) - seed(m.blackEntrantId)), 2);
});
test('unpairable later rounds fail explicitly without moving the schedule or inventing scores', () => {
  const f = fixture(4, 3); f.prepare();
  const m = f.raw().rounds[0].matches[0];
  // Remove three entrants after published pairing, leaving a single future
  // entrant whose previous full-point forfeit makes them ineligible for a bye.
  const survivor = f.owner(m.blackEntrantId);
  for (const p of f.players.filter(p => p !== survivor)) f.service.withdraw(f.tournament.id, p);
  f.setTime(3000); f.service.tick();
  assert.equal(f.raw().status, 'FAILED');
  assert.equal(f.raw().rounds[1].failure.code, 'NO_VALID_PAIRING');
  assert.equal(f.raw().rounds[1].startsAt, 14000);
  assert.equal(f.raw().rounds[1].matches.length, 0);
});
test('later Swiss rounds pair equal score brackets when feasible', () => {
  const f = fixture(8, 2), round = f.start();
  for (const m of round.matches) {
    f.service.command(f.tournament.id, m.id, f.owner(m.blackEntrantId), { commandId: 'resign', type: 'RESIGN' });
  }
  const scores = new Map(f.service.standings(f.tournament.id).map(e => [e.entrantId, e.score]));
  const next = f.raw().rounds[1];
  assert.equal(next.status, 'PAIRED');
  assert.ok(next.matches.every(m => scores.get(m.whiteEntrantId) === scores.get(m.blackEntrantId)));
});
