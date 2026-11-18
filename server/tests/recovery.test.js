const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FileStore, MemoryStore } = require('../persistence/store');
const { TournamentService } = require('../tournaments/service');
const { fixture } = require('./helpers');

test('transactions roll back and do not expose internal references', () => {
  const store = new MemoryStore();
  assert.throws(() => store.transaction(s => { s.sessions.foo = {}; throw new Error('abort'); }));
  assert.equal(store.read(s => s.sessions.foo), undefined);
  let captured;
  store.transaction(s => { s.sessions.foo = { value: 1 }; return s.sessions.foo; }).value = 2;
  assert.equal(store.read(s => s.sessions.foo.value), 1);
  assert.throws(() => store.transaction(async () => { captured = true; }), /Async transaction/);
  assert.equal(captured, true);
});
test('file checkpoint restores accepted moves, sessions, seeding and fixed schedule', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-tournament-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.json');
  const store = new FileStore(filename);
  const f = fixture(2, 1, { store });
  const m = f.start().matches[0], w = f.owner(m.whiteEntrantId);
  const cmd = { type: 'MOVE', commandId: 'durable', expectedMoveSequence: 0,
    from: { row: 1, col: 4 }, to: { row: 3, col: 4 } };
  const accepted = f.service.command(f.tournament.id, m.id, w, cmd);
  store.transaction(s => { s.sessions.auth = { value: { name: w }, expiresAt: 9999999999999 }; });
  assert.throws(() => new FileStore(filename), /already owned/);
  store.close();
  const recoveredStore = new FileStore(filename); t.after(() => recoveredStore.close());
  const service = new TournamentService({ store: recoveredStore, clock: () => 3500 });
  service.recover();
  const restored = service.game(f.tournament.id, m.id, w);
  assert.deepEqual(restored.board, accepted.board);
  assert.equal(restored.turn, 'black');
  assert.equal(restored.moveSequence, 1);
  assert.equal(restored.disconnects.white.deadlineAt, 4500);
  assert.equal(service.get(f.tournament.id).rounds[0].startsAt, 3000);
  assert.equal(recoveredStore.read(s => s.sessions.auth.value.name), w);
  assert.deepEqual(service.command(f.tournament.id, m.id, w, cmd), accepted);
});
test('restart after hard deadline draws, then catches up later rounds at original times', () => {
  const f = fixture(4, 3); f.start();
  const service = new TournamentService({ store: f.store, clock: () => 40000 });
  service.recover();
  const t = f.raw();
  assert.equal(t.status, 'COMPLETED');
  assert.equal(t.rounds[0].matches[0].result.reason, 'MATCH_DEADLINE');
  assert.equal(t.rounds[0].matches[0].result.effectiveAt, 13000);
  assert.equal(t.rounds[1].startsAt, 14000);
  assert.ok(t.rounds[1].matches.every(m => m.result.reason === 'DOUBLE_NO_SHOW'));
  assert.equal(t.rounds[2].startsAt, 25000);
});
test('already elapsed reconnect deadline is not erased by server recovery grace', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.service.disconnect(f.owner(m.whiteEntrantId) + ':1');
  const service = new TournamentService({ store: f.store, clock: () => 5000 }); service.recover();
  assert.equal(f.raw().rounds[0].matches[0].result.outcome, 'BLACK_WIN');
  assert.equal(f.raw().rounds[0].matches[0].result.effectiveAt, 4000);
});
test('disk failure rolls back game command without acknowledging or mutating accepted state', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.store.commit = () => { throw new Error('disk full'); };
  assert.throws(() => f.service.command(f.tournament.id, m.id, f.owner(m.whiteEntrantId), {
    type: 'MOVE', commandId: 'not-committed', expectedMoveSequence: 0,
    from: { row: 1, col: 4 }, to: { row: 3, col: 4 },
  }), /disk full/);
  assert.equal(f.raw().rounds[0].matches[0].game.moves.length, 0);
});
test('graceful shutdown grants fresh recovery grace instead of a player disconnect loss', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.service.prepareShutdown();
  const service = new TournamentService({ store: f.store, clock: () => 6000 });
  service.recover();
  const restored = service.game(f.tournament.id, m.id, f.owner(m.whiteEntrantId));
  assert.equal(restored.result, null);
  assert.equal(restored.disconnects.white.deadlineAt, 7000);
  assert.equal(restored.disconnects.black.deadlineAt, 7000);
});
test('shutdown does not suppress an earlier actual player reconnect expiry', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  f.service.disconnect(f.owner(m.whiteEntrantId) + ':1');
  f.service.prepareShutdown();
  new TournamentService({ store: f.store, clock: () => 6000 }).recover();
  const result = f.raw().rounds[0].matches[0].result;
  assert.equal(result.outcome, 'BLACK_WIN');
  assert.equal(result.effectiveAt, 4000);
});
test('corrupt checkpoint fails closed instead of replacing tournament state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'state.json'); fs.writeFileSync(filename, '{broken');
  assert.throws(() => new FileStore(filename));
  assert.equal(fs.readFileSync(filename, 'utf8'), '{broken');
  assert.equal(fs.existsSync(filename + '.lock'), false);
});
