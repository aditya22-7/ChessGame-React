const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { POLICY, calculate, expectedScore, RatingService, validateStorage } = require('../ratings/elo');
const { MemoryStore, FileStore } = require('../persistence/store');
const { TournamentService } = require('../tournaments/service');
const { fixture } = require('./helpers');

const result = (changes = {}) => ({ gameId: 'game-1', whitePlayerId: 'alice', blackPlayerId: 'bob',
  outcome: 'WHITE_WIN', reason: 'GAME_COMPLETED', moveCount: 9, completedAt: 10000, ...changes });
function played(f) {
  const m = f.start().matches[0];
  for (const [i, from, to] of [[0, [1, 4], [3, 4]], [1, [6, 4], [4, 4]]]) {
    f.service.command(f.tournament.id, m.id, f.owner(m[i ? 'blackEntrantId' : 'whiteEntrantId']), {
      commandId: 'play-' + i, type: 'MOVE', expectedMoveSequence: i,
      from: { row: from[0], col: from[1] }, to: { row: to[0], col: to[1] },
    });
  }
  return m;
}
test('Elo math: equal opponents, stronger favorite, upset and draw', () => {
  assert.equal(expectedScore(1200, 1200), 0.5);
  assert.equal(calculate(1200, 1200, 'WHITE_WIN').whiteAfter, 1216);
  assert.equal(calculate(1200, 1200, 'BLACK_WIN').whiteAfter, 1184);
  assert.equal(calculate(1200, 1200, 'DRAW').whiteAfter, 1200);
  assert.equal(calculate(1400, 1200, 'WHITE_WIN').whiteDelta, 8);
  assert.equal(calculate(1200, 1400, 'WHITE_WIN').whiteDelta, 24);
  assert.equal(calculate(1400, 1200, 'DRAW').whiteDelta, -8);
  for (const a of [0, 1200, 1400, 2600]) for (const b of [0, 1200, 1400, 2600]) for (const outcome of ['WHITE_WIN', 'DRAW', 'BLACK_WIN']) {
    const change = calculate(a, b, outcome);
    assert.equal(change.whiteAfter + change.blackAfter, a + b);
    assert.ok(Math.abs(change.whiteDelta) <= POLICY.k);
  }
  assert.throws(() => calculate(NaN, 1200, 'DRAW'), { code: 'INVALID_RATING' });
  assert.throws(() => calculate(1200, 1200, 'UNKNOWN'), { code: 'INVALID_RESULT' });
});
test('both ratings and history update exactly once and conflicting outcomes are rejected', () => {
  const ratings = new RatingService(new MemoryStore());
  assert.equal(ratings.get('alice').rating, 1200);
  const applied = ratings.settle(result());
  assert.equal(applied.rated, true);
  assert.deepEqual(ratings.settle(result()), applied);
  assert.equal(ratings.get('alice').rating, 1216); assert.equal(ratings.get('bob').rating, 1184);
  assert.equal(ratings.get('alice').wins, 1); assert.equal(ratings.get('bob').losses, 1);
  assert.equal(ratings.history('alice').total, 1);
  assert.equal(ratings.history('bob').games[0].delta, -16);
  assert.throws(() => ratings.settle(result({ outcome: 'BLACK_WIN' })), { code: 'RATING_RESULT_CONFLICT' });
  assert.equal(ratings.get('alice').ratedGames, 1);
});
test('next match uses both current pre-game ratings and histories paginate in settlement order', () => {
  const ratings = new RatingService(new MemoryStore());
  ratings.settle(result());
  const expected = calculate(1216, 1184, 'DRAW');
  ratings.settle(result({ gameId: 'game-2', outcome: 'DRAW' }));
  assert.equal(ratings.get('alice').rating, expected.whiteAfter);
  assert.equal(ratings.get('alice').draws, 1);
  assert.equal(ratings.history('alice', { limit: 1 }).games[0].gameId, 'game-2');
  assert.equal(ratings.history('alice', { limit: 1, offset: 1 }).games[0].gameId, 'game-1');
  assert.throws(() => ratings.history('alice', { limit: 101 }), { code: 'INVALID_PAGINATION' });
});
test('forfeits, disconnects, self-play, guests and games without both sides moving are unrated', () => {
  const ratings = new RatingService(new MemoryStore());
  const reasons = ['SINGLE_NO_SHOW', 'DOUBLE_NO_SHOW', 'WITHDRAWAL', 'RECONNECT_EXPIRED', 'DOUBLE_DISCONNECT'];
  reasons.forEach(reason => assert.equal(ratings.settle(result({ gameId: reason, reason })).rated, false));
  assert.equal(ratings.settle(result({ gameId: 'self', blackPlayerId: 'alice' })).excludedReason, 'SELF_PLAY');
  assert.equal(ratings.settle(result({ gameId: 'guest', blackPlayerId: null })).excludedReason, 'UNAUTHENTICATED_PLAYERS');
  assert.equal(ratings.settle(result({ gameId: 'short', moveCount: 1 })).excludedReason, 'INSUFFICIENT_PLAY');
  assert.equal(ratings.get('alice').ratedGames, 0);
  assert.equal(ratings.history('alice').total, 0);
});
test('tournament result and Elo commit together, duplicate commands cannot double-rate', () => {
  const f = fixture(2, 1), m = played(f), ratings = new RatingService(f.store);
  const black = f.owner(m.blackEntrantId), white = f.owner(m.whiteEntrantId);
  const command = { type: 'RESIGN', commandId: 'resign' };
  const completed = f.service.command(f.tournament.id, m.id, black, command);
  assert.equal(completed.result.rating.rated, true);
  assert.equal(ratings.get(white).rating, 1216);
  assert.equal(ratings.get(black).rating, 1184);
  assert.deepEqual(f.service.command(f.tournament.id, m.id, black, command), completed);
  assert.equal(ratings.get(white).ratedGames, 1);
  assert.equal(ratings.history(white).games[0].tournamentName, 'Test tournament');
});
test('played deadline draws count; no-show and no-move deadline draws do not', () => {
  const f = fixture(2, 1); played(f); f.setTime(13000); f.service.tick();
  assert.equal(new RatingService(f.store).get('p0').draws, 1);
  const g = fixture(2, 1); g.start(); g.setTime(13000); g.service.tick();
  assert.equal(new RatingService(g.store).get('p0').ratedGames, 0);
  const h = fixture(2, 1); h.prepare(); h.setTime(3000); h.service.tick();
  assert.equal(new RatingService(h.store).get('p0').ratedGames, 0);
});
test('a played withdrawal is still an administrative result and does not change Elo', () => {
  const f = fixture(2, 1), m = played(f);
  f.service.withdraw(f.tournament.id, f.owner(m.whiteEntrantId));
  assert.equal(new RatingService(f.store).get('p0').ratedGames, 0);
});
test('disk failure rolls back result, both player ratings and idempotency receipt', () => {
  const f = fixture(2, 1), m = played(f);
  f.store.commit = () => { throw new Error('disk unavailable'); };
  assert.throws(() => f.service.command(f.tournament.id, m.id, f.owner(m.blackEntrantId), { type: 'RESIGN', commandId: 'finish' }), /disk unavailable/);
  assert.equal(f.raw().rounds[0].matches[0].result, null);
  assert.equal(new RatingService(f.store).get('p0').ratedGames, 0);
  assert.equal(f.store.read(s => Object.keys(s.ratingResults).length), 0);
});
test('Elo and history survive disk restore and recovery cannot apply a result again', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-elo-'));
  const filename = path.join(dir, 'state.json');
  let store = new FileStore(filename);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const f = fixture(2, 1, { store }), m = played(f), black = f.owner(m.blackEntrantId);
  const cmd = { type: 'RESIGN', commandId: 'finish' };
  f.service.command(f.tournament.id, m.id, black, cmd);
  store.close(); store = new FileStore(filename);
  const service = new TournamentService({ store, clock: () => 20000 }); service.recover();
  service.command(f.tournament.id, m.id, black, cmd);
  assert.equal(new RatingService(store).get(black).rating, 1184);
  assert.equal(new RatingService(store).history(black).total, 1);
});
test('pre-Elo checkpoints gain empty rating storage without retroactively rating old results', () => {
  const f = fixture(2, 1); f.start(); f.setTime(13000); f.service.tick();
  f.store.transaction(s => { delete s.ratings; delete s.ratingResults; validateStorage(s); });
  f.service.recover();
  assert.equal(new RatingService(f.store).get('p0').ratedGames, 0);
});
test('corrupt stored profiles are rejected and special valid player IDs remain safe', () => {
  const store = new MemoryStore(), service = new RatingService(store);
  service.settle(result({ whitePlayerId: '__proto__' }));
  assert.equal(service.get('__proto__').rating, 1216);
  assert.equal(service.get('constructor').rating, 1200);
  assert.throws(() => store.transaction(s => { s.ratings.bob.rating = null; validateStorage(s); }), { code: 'INVALID_RATING_STORAGE' });
  assert.equal(service.get('bob').rating, 1184);
});
