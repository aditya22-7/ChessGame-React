const express = require('express');
const { requireThat } = require('../tournaments/errors');
function ratingRoutes(service, canonicalPlayer) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.session?.isAuth) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login required' } });
    next();
  });
  const handle = fn => (req, res, next) => { try { res.json(fn(req)); } catch (error) { next(error); } };
  const player = req => {
    const playerId = canonicalPlayer(req.params.playerId === 'me' ? req.session.name : req.params.playerId);
    requireThat(playerId,
      'PLAYER_NOT_FOUND', 'Player not found', 404);
    return playerId;
  };
  router.get('/:playerId/rating', handle(req => service.get(player(req))));
  router.get('/:playerId/rating-history', handle(req => service.history(player(req), {
    limit: req.query.limit === undefined ? 20 : Number(req.query.limit),
    offset: req.query.offset === undefined ? 0 : Number(req.query.offset),
  })));
  return router;
}
module.exports = { ratingRoutes };
