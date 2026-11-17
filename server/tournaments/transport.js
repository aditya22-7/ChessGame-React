const express = require('express');
const { DomainError } = require('./errors');

function requireLogin(req, res, next) {
  if (!req.session?.isAuth || typeof req.session.name !== 'string') {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
  }
  next();
}
function router(service) {
  const routes = express.Router();
  routes.use(requireLogin);
  const handle = fn => (req, res, next) => {
    try { res.json(fn(req)); } catch (error) { next(error); }
  };
  routes.get('/', handle(() => service.list()));
  routes.get('/:id', handle(req => service.get(req.params.id)));
  routes.get('/:id/standings', handle(req => service.standings(req.params.id)));
  routes.get('/:id/rounds', handle(req => service.get(req.params.id).rounds));
  routes.get('/:id/my-status', handle(req => service.mine(req.params.id, req.session.name)));
  routes.post('/:id/registrations', handle(req => service.register(req.params.id, req.session.name)));
  routes.delete('/:id/registrations/me', handle(req => service.withdraw(req.params.id, req.session.name)));
  routes.get('/:id/matches/:matchId', handle(req => service.game(req.params.id, req.params.matchId, req.session.name)));
  // Attendance is socket-bound. An HTTP request cannot prove a live game connection.
  return routes;
}
function errorPayload(error) {
  return { code: error instanceof DomainError ? error.code : 'INTERNAL_ERROR',
    message: error instanceof DomainError ? error.message : 'Unexpected server error' };
}
function socketTransport(io, service, sessionMiddleware) {
  const authorize = socket => new Promise((resolve, reject) => {
    // Reload persistent auth for each command, so logout revokes existing sockets.
    if (!socket.request.session) return reject(new DomainError('UNAUTHENTICATED', 'Login required', 401));
    socket.request.session.reload(error => {
      if (error || !socket.request.session?.isAuth) reject(new DomainError('UNAUTHENTICATED', 'Login required', 401));
      else resolve(socket.request.session.name);
    });
  });
  io.engine.use(sessionMiddleware);
  io.on('connection', socket => {
    const bind = (event, action) => socket.on(event, async (input, ack) => {
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_REQUEST', 'Object payload required', 400);
        const playerId = await authorize(socket);
        if (!socket.connected) throw new DomainError('CONNECTION_CLOSED', 'Socket has disconnected');
        const result = await action(input, playerId);
        if (typeof ack === 'function') ack({ ok: true, data: result });
      } catch (error) {
        if (!(error instanceof DomainError)) console.error('Tournament socket error:', error);
        if (typeof ack === 'function') ack({ ok: false, error: errorPayload(error) });
      }
    });
    bind('tournament:subscribe', async ({ tournamentId }) => {
      const value = service.get(tournamentId);
      await socket.join(`tournament:${tournamentId}`);
      return value;
    });
    bind('game:join', async ({ tournamentId, matchId }, playerId) => {
      if (socket.side) throw new DomainError('ALREADY_PLAYING', 'Leave quick play before joining a tournament match');
      const value = service.join(tournamentId, matchId, playerId, socket.id);
      socket.data.tournamentPlayerId = playerId;
      await socket.join(`tournament:${tournamentId}`);
      await socket.join(`match:${matchId}`);
      return value;
    });
    bind('game:sync', ({ tournamentId, matchId }, playerId) => service.game(tournamentId, matchId, playerId));
    bind('game:command', ({ tournamentId, matchId, command }, playerId) => service.command(tournamentId, matchId, playerId, command));
    bind('game:leave', async () => {
      service.disconnect(socket.id);
      delete socket.data.tournamentPlayerId;
      for (const room of socket.rooms) if (room.startsWith('match:')) await socket.leave(room);
      return { left: true };
    });
    socket.on('disconnect', () => {
      try { service.disconnect(socket.id); } catch (error) { console.error('Failed to persist disconnect:', error); }
    });
  });
  return event => {
    io.to(`tournament:${event.tournamentId}`).emit('tournament:event', {
      eventId: event.id, tournamentId: event.tournamentId, type: event.type,
      version: event.version, ...event.payload,
    });
  };
}
module.exports = { router, socketTransport, errorPayload };
