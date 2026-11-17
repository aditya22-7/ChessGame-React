const { randomUUID, createHash } = require('node:crypto');
const { requireThat, DomainError } = require('./errors');
const { FormatRegistry } = require('./formats/swiss');
const { standings, pairingPlayers } = require('./standings');
const engine = require('../games/engine');

const id = () => randomUUID();
const terminal = t => ['COMPLETED', 'FAILED'].includes(t.status);
const integer = (v, min = 1) => Number.isSafeInteger(v) && v >= min;
const playerValid = p => typeof p === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(p);
function seededOrder(entrants, seed) {
  return [...entrants].sort((a, b) => {
    const key = e => createHash('sha256').update(seed + ':' + e.playerId).digest('hex');
    return key(a).localeCompare(key(b)) || a.playerId.localeCompare(b.playerId);
  });
}

/** All mutations are serializable transactions through the storage port.
 * No live sockets or engine instances are retained in persistent state.
 */
class TournamentService {
  constructor({ store, clock = () => Date.now(), formats = new FormatRegistry() }) {
    this.store = store; this.clock = clock; this.formats = formats;
    this.connections = new Map();
  }
  _event(state, tournament, type, payload = {}) {
    tournament.version++;
    state.outbox.push({ id: ++state.eventSequence, tournamentId: tournament.id,
      type, payload, version: tournament.version, delivered: false });
  }
  _get(state, tournamentId) {
    const t = typeof tournamentId === 'string' && Object.hasOwn(state.tournaments, tournamentId) ? state.tournaments[tournamentId] : null;
    requireThat(t, 'NOT_FOUND', 'Tournament not found', 404);
    return t;
  }
  _match(t, matchId) {
    for (const round of t.rounds) {
      const match = round.matches.find(m => m.id === matchId);
      if (match) return { match, round };
    }
    throw new DomainError('NOT_FOUND', 'Match not found', 404);
  }
  _side(t, match, playerId) {
    for (const side of ['white', 'black']) {
      if (t.entrants.find(e => e.id === match[side + 'EntrantId'])?.playerId === playerId) return side;
    }
    throw new DomainError('FORBIDDEN', 'Player is not assigned to this match', 403);
  }
  create(config) {
    const now = this.clock();
    requireThat(config && typeof config === 'object', 'INVALID_CONFIG', 'Configuration required', 400);
    const { name, firstRoundStartsAt, registrationClosesAt, totalRounds, matchDurationMs, interRoundGapMs } = config;
    requireThat(typeof name === 'string' && name.trim().length > 0 && name.length <= 120,
      'INVALID_CONFIG', 'Name must be 1–120 characters', 400);
    requireThat(integer(firstRoundStartsAt) && integer(registrationClosesAt) &&
      registrationClosesAt > now && registrationClosesAt < firstRoundStartsAt,
      'INVALID_SCHEDULE', 'Registration must close in the future before round one', 400);
    requireThat(integer(totalRounds) && totalRounds <= 100 && integer(matchDurationMs) &&
      integer(interRoundGapMs) && interRoundGapMs >= 1000,
      'INVALID_SCHEDULE', 'Positive duration, 1–100 rounds, and a gap of at least 1000ms required', 400);
    const finalEnd = firstRoundStartsAt + totalRounds * (matchDurationMs + interRoundGapMs);
    requireThat(Number.isSafeInteger(finalEnd), 'INVALID_SCHEDULE', 'Schedule is outside supported range', 400);
    const format = config.format ?? 'SWISS';
    this.formats.get(format);
    const reconnectGraceMs = config.reconnectGraceMs ?? 60000;
    const maxEntrants = config.maxEntrants ?? 256;
    requireThat(integer(reconnectGraceMs) && integer(maxEntrants, 2) && maxEntrants <= 1024,
      'INVALID_CONFIG', 'Invalid reconnect window or capacity (2–1024)', 400);
    return this.store.transaction(state => {
      const tournament = {
        id: id(), name: name.trim(), format, status: 'REGISTRATION_OPEN', totalRounds,
        provisionKey: config.key ?? null,
        registrationClosesAt, firstRoundStartsAt, matchDurationMs, interRoundGapMs,
        maxEntrants, reconnectGraceMs, createdAt: now, version: 0,
        pairingSeed: randomUUID(), rulesVersion: 'platform-swiss-1',
        tiebreakVersion: 'FIDE-2026-03-platform-double-absence',
        entrants: [], rounds: Array.from({ length: totalRounds }, (_, i) => ({
          id: id(), number: i + 1, status: 'SCHEDULED',
          startsAt: firstRoundStartsAt + i * (matchDurationMs + interRoundGapMs),
          endsAt: firstRoundStartsAt + i * (matchDurationMs + interRoundGapMs) + matchDurationMs,
          startedAt: null, completedAt: null, matches: [], awards: [],
        })),
      };
      state.tournaments[tournament.id] = tournament;
      this._event(state, tournament, 'tournament:created');
      return this._public(tournament);
    });
  }
  register(tournamentId, playerId) {
    requireThat(playerValid(playerId), 'INVALID_PLAYER', 'Invalid player identity', 400);
    this.tick();
    return this.store.transaction(state => {
      const t = this._get(state, tournamentId);
      const existing = t.entrants.find(e => e.playerId === playerId);
      if (existing?.status === 'REGISTERED') return existing;
      requireThat(!existing, 'WITHDRAWN', 'Withdrawal is permanent; re-entry is disabled');
      requireThat(t.status === 'REGISTRATION_OPEN' && this.clock() < t.registrationClosesAt,
        'REGISTRATION_CLOSED', 'Registration is closed');
      requireThat(t.entrants.filter(e => e.status === 'REGISTERED').length < t.maxEntrants, 'TOURNAMENT_FULL', 'Tournament is full');
      const entrant = { id: id(), playerId, status: 'REGISTERED', seed: null,
        registeredAt: this.clock(), withdrawnAt: null };
      t.entrants.push(entrant);
      this._event(state, t, 'entrant:registered', { entrantId: entrant.id });
      return entrant;
    });
  }
  withdraw(tournamentId, playerId) {
    this.tick();
    return this.store.transaction(state => {
      const t = this._get(state, tournamentId);
      const entrant = t.entrants.find(e => e.playerId === playerId);
      requireThat(entrant, 'NOT_REGISTERED', 'Player is not registered', 404);
      if (entrant.status === 'WITHDRAWN') return entrant;
      requireThat(!terminal(t), 'TOURNAMENT_OVER', 'Tournament has ended');
      entrant.status = 'WITHDRAWN'; entrant.withdrawnAt = this.clock();
      for (const round of t.rounds) for (const match of round.matches) {
        if (!match.result && [match.whiteEntrantId, match.blackEntrantId].includes(entrant.id)) {
          this._finalize(state, t, match, match.whiteEntrantId === entrant.id ? 'BLACK_WIN' : 'WHITE_WIN', 'WITHDRAWAL', this.clock());
        }
      }
      for (const round of t.rounds) if (round.startedAt === null) {
        const award = round.awards.find(a => a.entrantId === entrant.id);
        if (award) { award.points = 0; award.type = 'WITHDRAWN_BYE'; }
      }
      this._event(state, t, 'entrant:withdrawn', { entrantId: entrant.id });
      this._progress(state, t, this.clock());
      return entrant;
    });
  }
  _finalize(state, t, match, outcome, reason, at) {
    if (match.result) return match.result;
    const result = { id: id(), outcome, reason, effectiveAt: at, recordedAt: this.clock(),
      whitePoints: outcome === 'DRAW' ? 0.5 : outcome === 'WHITE_WIN' ? 1 : 0,
      blackPoints: outcome === 'DRAW' ? 0.5 : outcome === 'BLACK_WIN' ? 1 : 0 };
    match.result = result; match.status = 'FINALIZED';
    if (match.game) match.game.status = 'FINALIZED';
    this._event(state, t, 'match:finalized', { matchId: match.id, result });
    return result;
  }
  _prepare(state, t, round, at) {
    if (round.status !== 'SCHEDULED') return;
    try {
      const players = pairingPlayers(t);
      requireThat(players.length > 0, 'NO_ELIGIBLE_ENTRANTS', 'No active entrants remain');
      const strategy = this.formats.get(t.format);
      const proposal = strategy.generateRound(players);
      round.pairingAlgorithmVersion = strategy.version;
      round.pairingInputHash = createHash('sha256').update(JSON.stringify(players)).digest('hex');
      round.pairingsPublishedAt = at;
      round.matches = proposal.matches.map((p, i) => ({
        id: id(), boardNumber: i + 1, whiteEntrantId: p.white, blackEntrantId: p.black,
        status: 'WAITING', startsAt: round.startsAt, deadlineAt: round.endsAt,
        startedAt: null, result: null,
        attendance: { white: { joinedAt: null, connected: false }, black: { joinedAt: null, connected: false } },
        game: { id: id(), ruleset: engine.ruleset, status: 'WAITING', moves: [], commands: {},
          disconnects: { white: null, black: null }, drawOffer: null },
      }));
      if (proposal.bye) round.awards.push({ entrantId: proposal.bye, points: 1, type: 'PAIRING_BYE' });
      for (const e of t.entrants.filter(e => e.status === 'WITHDRAWN' && e.seed !== null)) {
        round.awards.push({ entrantId: e.id, points: 0, type: 'WITHDRAWN_BYE' });
      }
      round.status = 'PAIRED';
      this._event(state, t, 'round:paired', { roundNumber: round.number });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      round.status = 'FAILED'; round.failure = { code: error.code, message: error.message, at };
      t.status = 'FAILED';
      this._event(state, t, 'tournament:failed', { roundNumber: round.number, ...round.failure });
    }
  }
  _progress(state, t, at) {
    if (terminal(t)) return;
    for (const round of t.rounds) {
      if (round.status === 'IN_PROGRESS' && round.matches.every(m => m.result)) {
        round.status = 'COMPLETED'; round.completedAt = at;
        this._event(state, t, 'round:completed', { roundNumber: round.number });
        const next = t.rounds[round.number];
        if (next) this._prepare(state, t, next, at);
        else {
          t.status = 'COMPLETED'; t.completedAt = at;
          this._event(state, t, 'tournament:completed');
        }
      }
    }
  }
  _next(t) {
    if (terminal(t)) return null;
    const events = [];
    if (t.status === 'REGISTRATION_OPEN') events.push({ at: t.registrationClosesAt, type: 'CLOSE', priority: 0 });
    for (const round of t.rounds) {
      if (round.status === 'PAIRED') events.push({ at: round.startsAt, type: 'START', round, priority: 3 });
      for (const match of round.matches) {
        if (match.result || match.status !== 'IN_PROGRESS') continue;
        events.push({ at: match.deadlineAt, type: 'END', match, priority: 1 });
        const ds = Object.fromEntries(Object.entries(match.game.disconnects)
          .map(([side, disconnect]) => [side, disconnect?.cause === 'SERVER_SHUTDOWN' ? null : disconnect]));
        if (ds.white && ds.black) {
          events.push({ at: Math.max(ds.white.deadlineAt, ds.black.deadlineAt), type: 'DISCONNECT', match, priority: 2 });
        } else for (const side of ['white', 'black']) if (ds[side]) {
          events.push({ at: ds[side].deadlineAt, type: 'DISCONNECT', match, priority: 2 });
        }
      }
    }
    return events.sort((a, b) => a.at - b.at || a.priority - b.priority)[0];
  }
  _reconcile(state, t, now) {
    let event;
    while ((event = this._next(t)) && event.at <= now) {
      if (event.type === 'CLOSE') {
        const active = t.entrants.filter(e => e.status === 'REGISTERED');
        if (active.length < 2 || t.totalRounds > (active.length % 2 ? active.length : active.length - 1)) {
          t.status = 'FAILED'; t.failure = { code: 'INSUFFICIENT_FIELD', at: event.at };
          this._event(state, t, 'tournament:failed', t.failure);
          break;
        }
        seededOrder(active, t.pairingSeed).forEach((e, i) => { e.seed = i + 1; });
        t.status = 'READY';
        this._prepare(state, t, t.rounds[0], event.at);
      } else if (event.type === 'START') {
        const round = event.round;
        round.status = 'IN_PROGRESS'; round.startedAt = event.at; t.status = 'IN_PROGRESS';
        for (const match of round.matches) {
          if (match.result) continue;
          const w = match.attendance.white.connected, b = match.attendance.black.connected;
          if (w && b) {
            match.status = 'IN_PROGRESS'; match.startedAt = event.at; match.game.status = 'IN_PROGRESS';
            this._event(state, t, 'match:started', { matchId: match.id });
          } else this._finalize(state, t, match, w ? 'WHITE_WIN' : b ? 'BLACK_WIN' : 'DRAW',
            w || b ? 'SINGLE_NO_SHOW' : 'DOUBLE_NO_SHOW', event.at);
        }
        this._event(state, t, 'round:started', { roundNumber: round.number });
      } else if (event.type === 'END') this._finalize(state, t, event.match, 'DRAW', 'MATCH_DEADLINE', event.at);
      else {
        const ds = Object.fromEntries(Object.entries(event.match.game.disconnects)
          .map(([side, disconnect]) => [side, disconnect?.cause === 'SERVER_SHUTDOWN' ? null : disconnect]));
        this._finalize(state, t, event.match, ds.white && ds.black ? 'DRAW' : ds.white ? 'BLACK_WIN' : 'WHITE_WIN',
          ds.white && ds.black ? 'DOUBLE_DISCONNECT' : 'RECONNECT_EXPIRED', event.at);
      }
      this._progress(state, t, event.at);
    }
  }
  tick() {
    const now = this.clock();
    // Avoid rewriting the checkpoint on idle polls.
    if (!this.store.read(s => Object.values(s.tournaments).some(t => {
      const next = this._next(t); return next && next.at <= now;
    }))) return;
    this.store.transaction(state => {
      for (const t of Object.values(state.tournaments)) this._reconcile(state, t, now);
    });
  }
  recover() {
    this.connections.clear();
    const now = this.clock();
    this.store.transaction(state => {
      for (const t of Object.values(state.tournaments)) {
        if (terminal(t)) continue;
        // Historical deadlines win before granting restart grace. Waiting-room
        // connections cannot be assumed present during an offline round start.
        for (const round of t.rounds) for (const match of round.matches) {
          if (match.status === 'WAITING') for (const side of ['white', 'black']) match.attendance[side].connected = false;
        }
        this._reconcile(state, t, now);
        if (terminal(t)) continue;
        for (const round of t.rounds) for (const match of round.matches) {
          if (match.result) continue;
          for (const side of ['white', 'black']) {
            const wasConnected = match.attendance[side].connected;
            match.attendance[side].connected = false;
            if ((wasConnected || match.game.disconnects[side]?.cause === 'SERVER_SHUTDOWN') && match.status === 'IN_PROGRESS') match.game.disconnects[side] = {
              disconnectedAt: now, deadlineAt: Math.min(now + t.reconnectGraceMs, match.deadlineAt), cause: 'SERVER_RESTART',
            };
          }
          // Fail fast if a durable journal cannot reconstruct an active board.
          requireThat(match.game.ruleset === engine.ruleset, 'UNSUPPORTED_GAME_RULESET', 'Stored game ruleset is not supported');
          engine.restore(match.game.moves);
        }
        this._reconcile(state, t, now);
      }
    });
  }
  prepareShutdown() {
    this.tick();
    this.store.transaction(state => {
      for (const t of Object.values(state.tournaments)) for (const round of t.rounds) for (const match of round.matches) {
        if (match.result) continue;
        for (const side of ['white', 'black']) if (match.attendance[side].connected) {
          match.attendance[side].connected = false;
          if (match.status === 'IN_PROGRESS') match.game.disconnects[side] = {
            disconnectedAt: this.clock(), deadlineAt: match.deadlineAt, cause: 'SERVER_SHUTDOWN',
          };
        }
      }
    });
    this.connections.clear();
  }
  join(tournamentId, matchId, playerId, connectionId) {
    requireThat(typeof connectionId === 'string' && connectionId.length > 0, 'INVALID_CONNECTION', 'Socket connection required', 400);
    this.tick();
    const result = this.store.transaction(state => {
      const t = this._get(state, tournamentId), { match } = this._match(t, matchId);
      const side = this._side(t, match, playerId);
      requireThat(!terminal(t) && !match.result, 'MATCH_OVER', 'Match has ended');
      requireThat(t.entrants.find(e => e.playerId === playerId)?.status === 'REGISTERED', 'WITHDRAWN', 'Player withdrew');
      const now = this.clock();
      requireThat(match.status !== 'WAITING' || now < match.startsAt, 'ROUND_STARTED', 'Round has already started');
      const own = match.game.disconnects[side];
      requireThat(!own || own.deadlineAt > now, 'RECONNECT_EXPIRED', 'Reconnection window expired');
      match.attendance[side].connected = true;
      match.attendance[side].joinedAt ??= now;
      match.game.disconnects[side] = null;
      const other = side === 'white' ? 'black' : 'white';
      const otherDisconnect = match.game.disconnects[other];
      if (otherDisconnect && otherDisconnect.deadlineAt <= now) {
        this._finalize(state, t, match, side === 'white' ? 'WHITE_WIN' : 'BLACK_WIN', 'RECONNECT_EXPIRED', now);
        this._progress(state, t, now);
      }
      this._event(state, t, 'game:connection-status', { matchId, side, connected: true });
      return this._gameView(t, match, playerId);
    });
    const key = `${tournamentId}:${matchId}:${playerId}`;
    const set = this.connections.get(key) ?? new Set(); set.add(connectionId); this.connections.set(key, set);
    return result;
  }
  disconnect(connectionId) {
    this.tick();
    const lost = [];
    for (const [key, connections] of this.connections) {
      if (connections.delete(connectionId) && connections.size === 0) { lost.push(key); this.connections.delete(key); }
    }
    if (!lost.length) return;
    try {
      this.store.transaction(state => {
        for (const key of lost) {
          const [tournamentId, matchId, playerId] = key.split(':');
          const t = this._get(state, tournamentId), { match } = this._match(t, matchId);
          if (match.result) continue;
          const side = this._side(t, match, playerId);
          match.attendance[side].connected = false;
          if (match.status === 'IN_PROGRESS') match.game.disconnects[side] = {
            disconnectedAt: this.clock(), deadlineAt: Math.min(this.clock() + t.reconnectGraceMs, match.deadlineAt), cause: 'PLAYER_DISCONNECT',
          };
          this._event(state, t, 'game:connection-status', { matchId, side, connected: false });
        }
      });
    } catch (error) {
      for (const key of lost) this.connections.set(key, new Set([connectionId]));
      throw error;
    }
  }
  _gameView(t, match, playerId) {
    const side = this._side(t, match, playerId);
    return { tournamentId: t.id, matchId: match.id, gameSessionId: match.game.id, ruleset: match.game.ruleset,
      status: match.status, side, startsAt: match.startsAt, deadlineAt: match.deadlineAt,
      ...engine.view(engine.restore(match.game.moves)), moveSequence: match.game.moves.length,
      disconnects: match.game.disconnects, drawOffer: match.game.drawOffer, result: match.result, serverNow: this.clock() };
  }
  game(tournamentId, matchId, playerId) {
    this.tick();
    return this.store.read(state => {
      const t = this._get(state, tournamentId), { match } = this._match(t, matchId);
      return this._gameView(t, match, playerId);
    });
  }
  command(tournamentId, matchId, playerId, command) {
    this.tick();
    requireThat(command && typeof command.commandId === 'string' && /^[\w-]{1,100}$/.test(command.commandId),
      'INVALID_COMMAND', 'A unique commandId is required', 400);
    return this.store.transaction(state => {
      const t = this._get(state, tournamentId), { match } = this._match(t, matchId);
      const side = this._side(t, match, playerId);
      const key = `${playerId}:${command.commandId}`;
      const fingerprint = JSON.stringify(command);
      const previous = match.game.commands[key];
      if (previous) {
        requireThat(previous.fingerprint === fingerprint, 'COMMAND_CONFLICT', 'commandId was used for a different action');
        return previous.response;
      }
      requireThat(match.status === 'IN_PROGRESS' && !match.result, 'MATCH_NOT_PLAYING', 'Match is not in progress');
      const actionAt = this.clock();
      requireThat(actionAt < match.deadlineAt, 'MATCH_DEADLINE', 'Match deadline has elapsed');
      requireThat(match.attendance[side].connected, 'NOT_CONNECTED', 'Join the match before acting');
      if (command.type === 'MOVE') {
        requireThat(command.expectedMoveSequence === match.game.moves.length, 'STALE_MOVE', 'Refresh the authoritative game state');
        const game = engine.restore(match.game.moves);
        requireThat((game.turn ? 'white' : 'black') === side, 'NOT_YOUR_TURN', 'It is not your turn', 403);
        engine.apply(game, command);
        match.game.moves.push({ from: command.from, to: command.to, playerId, acceptedAt: actionAt });
        match.game.drawOffer = null;
        if (game.status) this._finalize(state, t, match, game.status === 'White' ? 'WHITE_WIN' : 'BLACK_WIN', 'GAME_COMPLETED', actionAt);
        this._event(state, t, 'game:updated', { matchId, moveSequence: match.game.moves.length });
      } else if (command.type === 'RESIGN') {
        this._finalize(state, t, match, side === 'white' ? 'BLACK_WIN' : 'WHITE_WIN', 'RESIGNATION', actionAt);
      } else if (command.type === 'OFFER_DRAW') {
        match.game.drawOffer = side;
        this._event(state, t, 'game:updated', { matchId });
      } else if (command.type === 'ACCEPT_DRAW') {
        requireThat(match.game.drawOffer && match.game.drawOffer !== side, 'NO_DRAW_OFFER', 'Opponent has not offered a draw');
        this._finalize(state, t, match, 'DRAW', 'DRAW_AGREEMENT', actionAt);
      } else throw new DomainError('INVALID_COMMAND', 'Unknown game command', 400);
      this._progress(state, t, actionAt);
      const response = this._gameView(t, match, playerId);
      match.game.commands[key] = { fingerprint, response };
      return response;
    });
  }
  _public(t) {
    return { id: t.id, name: t.name, format: t.format, status: t.status, totalRounds: t.totalRounds,
      registrationClosesAt: t.registrationClosesAt, maxEntrants: t.maxEntrants,
      entrantCount: t.entrants.filter(e => e.status === 'REGISTERED').length,
      reconnectGraceMs: t.reconnectGraceMs, version: t.version, failure: t.failure,
      rulesVersion: t.rulesVersion, tiebreakVersion: t.tiebreakVersion,
      rounds: t.rounds.map(r => ({ id: r.id, number: r.number, status: r.status, startsAt: r.startsAt,
        endsAt: r.endsAt, failure: r.failure, awards: r.startedAt !== null ? r.awards : [],
        matches: r.matches.map(m => ({ id: m.id, boardNumber: m.boardNumber,
          whiteEntrantId: m.whiteEntrantId, blackEntrantId: m.blackEntrantId,
          status: m.status, result: m.result })) })), serverNow: this.clock() };
  }
  get(tournamentId) { this.tick(); return this.store.read(s => this._public(this._get(s, tournamentId))); }
  list() { this.tick(); return this.store.read(s => Object.values(s.tournaments).map(t => this._public(t))); }
  standings(tournamentId) { this.tick(); return this.store.read(s => standings(this._get(s, tournamentId))); }
  mine(tournamentId, playerId) {
    this.tick();
    return this.store.read(state => {
      const t = this._get(state, tournamentId), entrant = t.entrants.find(e => e.playerId === playerId);
      const matches = entrant ? t.rounds.flatMap(r => r.matches.filter(m =>
        [m.whiteEntrantId, m.blackEntrantId].includes(entrant.id)).map(m => ({
          matchId: m.id, roundNumber: r.number, startsAt: m.startsAt, deadlineAt: m.deadlineAt, status: m.status, result: m.result,
        }))) : [];
      return { entrant, matches, nextRoundStartsAt: terminal(t) ? null : t.rounds.find(r => r.startsAt > this.clock())?.startsAt ?? null, serverNow: this.clock() };
    });
  }
  flushEvents(deliver) {
    const events = this.store.read(s => s.outbox.filter(e => !e.delivered));
    for (const event of events) {
      deliver(event); // Delivery is at least once; clients use event ID/version and resync.
      this.store.transaction(s => { s.outbox.find(e => e.id === event.id).delivered = true; });
    }
  }
}
module.exports = { TournamentService, seededOrder };
