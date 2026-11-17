const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const session = require('express-session');
const gameManager = require('./gameManager');
const { FileStore } = require('./server/persistence/store');
const { PersistentSessionStore } = require('./server/persistence/session-store');
const { TournamentService } = require('./server/tournaments/service');
const { router, socketTransport, errorPayload } = require('./server/tournaments/transport');
const { DeadlineWorker } = require('./server/scheduling/deadline-worker');
const { RatingService, validateStorage: validateRatingStorage } = require('./server/ratings/elo');
const { ratingRoutes } = require('./server/ratings/transport');

function createServer(options = {}) {
  const app = express();
  // Canonical file identities prevent case variants on Windows from becoming
  // separate rated accounts for the same login credentials.
  const usersDirectory = path.join(__dirname, 'server/users');
  const users = new Map(fs.readdirSync(usersDirectory).filter(file => file.endsWith('.json'))
    .map(file => [file.slice(0, -5).toLowerCase(), file.slice(0, -5)]));
  const canonicalPlayer = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value)
    ? users.get(value.toLowerCase()) : undefined;
  const origin = options.origin ?? process.env.CLIENT_ORIGIN ?? 'http://localhost:3000';
  const ownsStore = !options.store;
  const store = options.store ?? new FileStore(process.env.TOURNAMENT_STATE_FILE ?? path.join(__dirname, 'server/data/state.json'));
  const tournaments = new TournamentService({ store, clock: options.clock });
  const ratings = new RatingService(store);
  const quickPlay = new gameManager({ ratings, clock: options.clock });
  try {
    store.transaction(state => {
      validateRatingStorage(state);
      for (const record of Object.values(state.sessions)) if (record.value?.isAuth) {
        const playerId = canonicalPlayer(record.value.name);
        if (playerId) record.value.name = playerId;
        else record.value.isAuth = false;
      }
    });
    tournaments.recover();
    // Config provisioning avoids exposing organizer operations in the player API.
    if (options.provisionFile ?? process.env.TOURNAMENT_CONFIG_FILE) {
      const entries = JSON.parse(fs.readFileSync(options.provisionFile ?? process.env.TOURNAMENT_CONFIG_FILE, 'utf8'));
      if (!Array.isArray(entries)) throw new Error('Tournament config must be an array');
      for (const entry of entries) {
        if (typeof entry.key !== 'string' || !entry.key) throw new Error('Tournament configuration key required');
        const exists = store.read(s => Object.values(s.tournaments).some(t => t.provisionKey === entry.key));
        if (!exists) tournaments.create(entry);
      }
    }
  } catch (error) { if (ownsStore) store.close(); throw error; }
  app.use(express.static('public'));
  app.use(cors({ origin, credentials: true }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '16kb' }));
  const sessionMiddleware = session({
    secret: options.sessionSecret ?? process.env.SESSION_SECRET ?? 'local-development-change-me',
    resave: false, saveUninitialized: false,
    store: new PersistentSessionStore(store),
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 86400000 },
  });
  app.use(sessionMiddleware);
  app.get('/session', (req, res) => {
    if (!req.session?.isAuth) return res.status(401).json({error:{code:'UNAUTHENTICATED',message:'Login required'}});
    res.json({playerId:req.session.playerId??req.session.name,name:req.session.name});
  });
  app.post('/auth', (req, res, next) => {
    try {
      if (req.session.isAuth === false) return res.json({ status: 'failed' });
      if (req.session.isAuth) return res.json({ status: 'loggedIn', name: req.session.name });
      req.session.try ??= 0;
      const { username, password, count } = req.body ?? {};
      if (!username && !password) return res.json({ status: 'login', tries: req.session.try });
      if (count !== req.session.try + 1) return res.json({ status: 'restart' });
      req.session.try++;
      let valid = false;
      const playerId = canonicalPlayer(username);
      if (playerId && typeof password === 'string') {
        const filename = path.join(usersDirectory, playerId + '.json');
        if (fs.existsSync(filename)) valid = JSON.parse(fs.readFileSync(filename, 'utf8')).password === password;
      }
      if (valid) {
        req.session.regenerate(error => {
          if (error) return next(error);
          req.session.isAuth = true; req.session.name = playerId;
          req.session.save(error => error ? next(error) : res.json({ status: 'success' }));
        });
      } else if (req.session.try >= 3) { req.session.isAuth = false; res.json({ status: 'failed' }); }
      else res.json({ status: 'failure' });
    } catch (error) { next(error); }
  });
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin, credentials: true }, maxHttpBufferSize: 16 * 1024 });
  const deliver = socketTransport(io, tournaments, sessionMiddleware);
  io.on('connection', socket => quickPlay.manager(socket));
  app.post('/logout', (req, res, next) => {
    if (req.session.isAuth === undefined) return res.json('invalid');
    const sid = req.sessionID;
    req.session.destroy(error => {
      if (error) return next(error);
      for (const socket of io.sockets.sockets.values()) if (socket.request.sessionID === sid) socket.disconnect(true);
      res.clearCookie('connect.sid'); res.json('success');
    });
  });
  app.use('/tournaments', router(tournaments));
  app.use('/players', ratingRoutes(ratings, canonicalPlayer));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (!error.status) console.error('Backend error:', error);
    res.status(error.status ?? 500).json({ error: errorPayload(error) });
  });
  const worker = new DeadlineWorker(tournaments, deliver, { pollIntervalMs: options.pollIntervalMs ?? 250 });
  if (options.worker !== false) worker.start();
  const run = () => worker.run();
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    worker.stop();
    let shutdownError;
    try { tournaments.prepareShutdown(); } catch (error) { shutdownError = error; }
    try { await new Promise(resolve => io.close(resolve)); }
    finally {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      if (ownsStore) store.close();
    }
    if (shutdownError) throw shutdownError;
  }
  return { app, server, io, store, tournaments, ratings, run, close };
}
if (require.main === module) {
  (async () => {
    const mode = process.env.BACKEND_STORAGE ?? 'mysql';
    if (!['mysql', 'file'].includes(mode)) throw new Error('BACKEND_STORAGE must be mysql or file');
    const backend = mode === 'file' ? createServer() : await require('./server/sql/app').createSqlServer();
    backend.server.once('error', error => { console.error(error.message); backend.close().finally(() => { process.exitCode = 1; }); });
    backend.server.listen(Number(process.env.PORT ?? 8081), () => console.log('Chess backend listening on', backend.server.address().port, '(' + mode + ')'));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      backend.close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
    });
  })().catch(error => { console.error('Backend startup failed:', error.message); process.exitCode = 1; });
}
module.exports = { createServer, createSqlServer: options => require('./server/sql/app').createSqlServer(options) };
