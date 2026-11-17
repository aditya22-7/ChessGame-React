const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { once } = require('node:events');
const { io: connect } = require('socket.io-client');
const { createServer } = require('../../index');
const { MemoryStore } = require('../persistence/store');

async function backend(t) {
  let time = 1000;
  const app = createServer({ store: new MemoryStore(), clock: () => time, worker: false });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(() => app.close());
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const login = async name => {
    const user = JSON.parse(fs.readFileSync(path.join(__dirname, '../users', name + '.json'), 'utf8'));
    const response = await fetch(base + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: user.password, count: 1 }) });
    assert.equal((await response.json()).status, 'success');
    return response.headers.get('set-cookie').split(';')[0];
  };
  const socket = async cookie => {
    const s = connect(base, { transports: ['websocket'], extraHeaders: cookie ? { Cookie: cookie } : {}, forceNew: true, reconnection: false });
    t.after(() => s.disconnect());
    await once(s, 'connect'); return s;
  };
  return { ...app, base, login, socket, setTime: v => { time = v; } };
}
const emit = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(2000).emit(event, payload, (error, value) => error ? reject(error) : resolve(value));
});

test('HTTP authentication and session-owned registration reject impersonation', { timeout: 10000 }, async t => {
  const b = await backend(t);
  assert.equal((await fetch(b.base + '/tournaments')).status, 401);
  const tour = b.tournaments.create({ name: 'HTTP tournament', registrationClosesAt: 2000,
    firstRoundStartsAt: 3000, totalRounds: 1, matchDurationMs: 10000, interRoundGapMs: 1000 });
  const cookie = await b.login('jon');
  const response = await fetch(b.base + '/tournaments/' + tour.id + '/registrations', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId: 'tom' }),
  });
  assert.equal(response.status, 200); assert.equal((await response.json()).playerId, 'jon');
  assert.equal((await fetch(b.base + '/tournaments/missing', { headers: { Cookie: cookie } })).status, 404);
});
test('authenticated socket joins, recovers state, enforces turn and logout revokes access', { timeout: 10000 }, async t => {
  const b = await backend(t);
  const tour = b.tournaments.create({ name: 'Socket tournament', registrationClosesAt: 2000,
    firstRoundStartsAt: 3000, totalRounds: 1, matchDurationMs: 10000, interRoundGapMs: 1000 });
  const jonCookie = await b.login('jon'), tomCookie = await b.login('tom');
  for (const p of ['jon', 'tom']) b.tournaments.register(tour.id, p);
  b.setTime(2000); b.tournaments.tick();
  const m = b.tournaments.get(tour.id).rounds[0].matches[0];
  const anonymous = await b.socket();
  const denied = await emit(anonymous, 'game:join', { tournamentId: tour.id, matchId: m.id });
  assert.equal(denied.error.code, 'UNAUTHENTICATED');
  const jon = await b.socket(jonCookie), tom = await b.socket(tomCookie);
  const jr = await emit(jon, 'game:join', { tournamentId: tour.id, matchId: m.id });
  const tr = await emit(tom, 'game:join', { tournamentId: tour.id, matchId: m.id });
  assert.equal(jr.ok, true); assert.equal(tr.ok, true);
  b.setTime(3000); b.tournaments.tick();
  const white = jr.data.side === 'white' ? jon : tom;
  const black = white === jon ? tom : jon;
  const move = { type: 'MOVE', commandId: 'socket-move', expectedMoveSequence: 0,
    from: { row: 1, col: 4 }, to: { row: 3, col: 4 } };
  assert.equal((await emit(black, 'game:command', { tournamentId: tour.id, matchId: m.id, command: move })).error.code, 'NOT_YOUR_TURN');
  assert.equal((await emit(white, 'game:command', { tournamentId: tour.id, matchId: m.id, command: move })).data.moveSequence, 1);
  assert.equal((await emit(black, 'game:sync', { tournamentId: tour.id, matchId: m.id })).data.moveSequence, 1);
  const gone = once(jon, 'disconnect');
  const response = await fetch(b.base + '/logout', { method: 'POST', headers: { Cookie: jonCookie } });
  assert.equal(await response.json(), 'success'); await gone;
  assert.equal((await fetch(b.base + '/tournaments', { headers: { Cookie: jonCookie } })).status, 401);
});
test('legacy quick play pairs and exchanges moves without tournament session credentials', { timeout: 10000 }, async t => {
  const b = await backend(t), a = await b.socket(), c = await b.socket();
  const ad = once(a, 'getdata'), cd = once(c, 'getdata');
  a.emit('newgame', 'legacy-a'); c.emit('newgame', 'legacy-b');
  const [[av], [cv]] = await Promise.all([ad, cd]);
  assert.equal(av.side, 'white'); assert.equal(cv.side, 'black');
  const from = once(a, 'from'); a.emit('pt', { row: 1, col: 4 });
  assert.ok((await from)[0].some(t => t.row === 3 && t.col === 4));
  const to = once(a, 'to'), move = once(c, 'move'); a.emit('to', { row: 3, col: 4 });
  assert.ok(Array.isArray((await to)[0])); assert.ok(Array.isArray((await move)[0]));
  const left = once(a, 'left'); a.emit('leavegame'); await left;
});

test('HTTP sessions and provisioned tournament survive a complete server restart', { timeout: 10000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-http-recovery-'));
  const filename = path.join(dir, 'state.json'), provisionFile = path.join(dir, 'tournaments.json');
  fs.writeFileSync(provisionFile, JSON.stringify([{ key: 'stable-event', name: 'Recovery event',
    registrationClosesAt: 2000, firstRoundStartsAt: 3000, totalRounds: 1, matchDurationMs: 10000, interRoundGapMs: 1000 }]));
  const { FileStore } = require('../persistence/store');
  let store = new FileStore(filename);
  let app = createServer({ store, provisionFile, clock: () => 1000, worker: false, sessionSecret: 'persistent-test-secret' });
  t.after(async () => {
    try { await app.close(); }
    finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const user = JSON.parse(fs.readFileSync(path.join(__dirname, '../users/jon.json'), 'utf8'));
  const response = await fetch(base + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'jon', password: user.password, count: 1 }) });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await response.json()).status, 'success');
  const id = app.tournaments.list()[0].id;
  await app.close(); store.close();
  store = new FileStore(filename);
  app = createServer({ store, provisionFile, clock: () => 2500, worker: false, sessionSecret: 'persistent-test-secret' });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const restarted = 'http://127.0.0.1:' + app.server.address().port;
  const auth = await fetch(restarted + '/auth', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal((await auth.json()).status, 'loggedIn');
  assert.equal(app.tournaments.list().length, 1);
  assert.equal(app.tournaments.list()[0].id, id);
});

test('dead waiting quick-play entries are skipped after disconnect', { timeout: 10000 }, async t => {
  const b = await backend(t), departed = await b.socket();
  departed.emit('newgame', 'departed');
  // Wait for the server to acknowledge an explicit data request before leaving.
  const waiting = once(departed, 'getdata'); departed.emit('getdata'); await waiting;
  const serverSocket = b.io.sockets.sockets.get(departed.id);
  const disconnected = once(serverSocket, 'disconnect'); departed.disconnect(); await disconnected;
  const a = await b.socket(), c = await b.socket();
  const ad = once(a, 'getdata'), cd = once(c, 'getdata');
  a.emit('newgame', 'new-a'); c.emit('newgame', 'new-b');
  const [[av], [cv]] = await Promise.all([ad, cd]);
  assert.equal(av.name, 'new-b'); assert.equal(cv.name, 'new-a');
});
test('rating APIs require login, expose persisted history and reject client rating writes', { timeout: 10000 }, async t => {
  const b = await backend(t);
  assert.equal((await fetch(b.base + '/players/me/rating')).status, 401);
  const cookie = await b.login('jon'), headers = { Cookie: cookie };
  const profile = await fetch(b.base + '/players/me/rating', { headers });
  assert.equal((await profile.json()).rating, 1200);
  assert.equal((await fetch(b.base + '/players/missing/rating', { headers })).status, 404);
  assert.equal((await fetch(b.base + '/players/me/rating-history?limit=200', { headers })).status, 400);
  assert.equal((await fetch(b.base + '/players/me/rating', { method: 'POST', headers })).status, 404);
  assert.equal((await (await fetch(b.base + '/players/me/rating-history', { headers })).json()).total, 0);
});
test('authenticated quick-play king capture rates real identities once despite supplied aliases', { timeout: 10000 }, async t => {
  const b = await backend(t), jonCookie = await b.login('jon'), tomCookie = await b.login('tom');
  const a = await b.socket(jonCookie), c = await b.socket(tomCookie);
  const ad = once(a, 'getdata'), cd = once(c, 'getdata');
  a.emit('newgame', 'forged-one'); c.emit('newgame', 'forged-two');
  const [[av], [cv]] = await Promise.all([ad, cd]);
  assert.equal(av.name, 'tom'); assert.equal(cv.name, 'jon');
  assert.equal(av.rated, true);
  const white = av.side === 'white' ? a : c, black = white === a ? c : a;
  const sequence = [
    [[1, 4], [3, 4]], [[6, 0], [5, 0]], [[0, 4], [2, 4]],
    [[6, 7], [5, 7]], [[2, 4], [5, 1]], [[5, 0], [4, 0]],
    [[5, 1], [6, 2]], [[5, 7], [4, 7]], [[6, 2], [7, 3]],
  ];
  for (let i = 0; i < sequence.length; i++) {
    const [from, to] = sequence[i], actor = i % 2 ? black : white, other = actor === white ? black : white;
    const selected = once(actor, 'from'); actor.emit('pt', { row: from[0], col: from[1] });
    assert.ok(Array.isArray((await selected)[0]));
    const applied = once(actor, 'to'), changed = once(other, 'move');
    actor.emit('to', { row: to[0], col: to[1] });
    const [[response]] = await Promise.all([applied, changed]);
    if (i === sequence.length - 1) assert.equal(response.status, 'White');
  }
  const whiteId = white === a ? 'jon' : 'tom', blackId = white === a ? 'tom' : 'jon';
  assert.equal(b.ratings.get(whiteId).rating, 1216);
  assert.equal(b.ratings.get(blackId).rating, 1184);
  const duplicate = once(white, 'to'); white.emit('to', { row: 7, col: 3 });
  assert.equal((await duplicate)[0], 'invalid');
  assert.equal(b.ratings.get(whiteId).ratedGames, 1);
  const profile = await fetch(b.base + '/players/' + whiteId + '/rating', { headers: { Cookie: jonCookie } });
  assert.equal((await profile.json()).rating, 1216);
});
test('case variants of a login use one canonical rating identity', { timeout: 10000 }, async t => {
  const b = await backend(t);
  const user = JSON.parse(fs.readFileSync(path.join(__dirname, '../users/jon.json'), 'utf8'));
  const response = await fetch(b.base + '/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'JON', password: user.password, count: 1 }) });
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await response.json()).status, 'success');
  const auth = await fetch(b.base + '/auth', { method: 'POST', headers: { Cookie: cookie } });
  assert.equal((await auth.json()).name, 'jon');
  const profile = await fetch(b.base + '/players/JON/rating', { headers: { Cookie: cookie } });
  assert.equal((await profile.json()).playerId, 'jon');
});
