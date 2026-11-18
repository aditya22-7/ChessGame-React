const { requireThat } = require('../tournaments/errors');

const POLICY = Object.freeze({ version: 'platform-elo-1', initialRating: 1200, k: 32, scale: 400 });
const OUTCOMES = { WHITE_WIN: 1, BLACK_WIN: 0, DRAW: 0.5 };
const RATED_REASONS = new Set(['GAME_COMPLETED', 'RESIGNATION', 'DRAW_AGREEMENT', 'MATCH_DEADLINE']);
function expectedScore(rating, opponentRating) {
  requireThat(Number.isSafeInteger(rating) && Number.isSafeInteger(opponentRating), 'INVALID_RATING', 'Ratings must be safe integers', 400);
  return 1 / (1 + 10 ** ((opponentRating - rating) / POLICY.scale));
}
function calculate(whiteRating, blackRating, outcome) {
  requireThat(Object.hasOwn(OUTCOMES, outcome), 'INVALID_RESULT', 'Unknown rating outcome', 400);
  const expectedWhite = expectedScore(whiteRating, blackRating);
  const raw = POLICY.k * (OUTCOMES[outcome] - expectedWhite);
  // Round once symmetrically; both updates use the same pre-result ratings.
  const delta = Math.sign(raw) * Math.round(Math.abs(raw)) || 0;
  requireThat(Number.isSafeInteger(whiteRating + delta) && Number.isSafeInteger(blackRating - delta),
    'INVALID_RATING', 'Rating update exceeds supported range');
  return { expectedWhite, whiteDelta: delta, blackDelta: -delta || 0,
    whiteAfter: whiteRating + delta, blackAfter: blackRating - delta };
}
const blank = playerId => ({ playerId, rating: POLICY.initialRating, ratedGames: 0, wins: 0, draws: 0, losses: 0, updatedAt: null });
const validPlayer = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
function profile(state, playerId) {
  requireThat(validPlayer(playerId), 'INVALID_PLAYER', 'Invalid player identity', 400);
  return state.ratings && Object.hasOwn(state.ratings, playerId) ? state.ratings[playerId] : blank(playerId);
}
function validateStorage(state) {
  if (state.ratings === undefined && state.ratingResults === undefined) {
    state.ratings = {}; state.ratingResults = {};
  }
  requireThat(state.ratings && typeof state.ratings === 'object' && !Array.isArray(state.ratings) &&
    state.ratingResults && typeof state.ratingResults === 'object' && !Array.isArray(state.ratingResults),
  'INVALID_RATING_STORAGE', 'Invalid rating storage');
  for (const [key, value] of Object.entries(state.ratings)) {
    requireThat(value && key === value.playerId && validPlayer(key) && Number.isSafeInteger(value.rating) &&
      ['ratedGames', 'wins', 'draws', 'losses'].every(field => Number.isSafeInteger(value[field]) && value[field] >= 0) &&
      value.ratedGames === value.wins + value.draws + value.losses,
    'INVALID_RATING_STORAGE', 'Invalid stored player rating');
  }
}

/** Run inside the authoritative result transaction. Unrated decisions are also
 * retained, so a retried excluded result can never later become rated.
 */
function settle(state, game) {
  validateStorage(state);
  const { gameId, whitePlayerId, blackPlayerId, outcome, reason, moveCount, completedAt } = game;
  requireThat(typeof gameId === 'string' && gameId.length > 0 && Number.isSafeInteger(completedAt),
    'INVALID_RESULT', 'Game identity and timestamp required', 400);
  requireThat(Object.hasOwn(OUTCOMES, outcome), 'INVALID_RESULT', 'Unknown rating outcome', 400);
  const fingerprint = JSON.stringify([whitePlayerId, blackPlayerId, outcome, reason, moveCount]);
  if (Object.hasOwn(state.ratingResults, gameId)) {
    const existing = state.ratingResults[gameId];
    requireThat(existing.fingerprint === fingerprint, 'RATING_RESULT_CONFLICT', 'Game already has a different rating result');
    return existing;
  }
  let excludedReason = null;
  if (!validPlayer(whitePlayerId) || !validPlayer(blackPlayerId)) excludedReason = 'UNAUTHENTICATED_PLAYERS';
  else if (whitePlayerId === blackPlayerId) excludedReason = 'SELF_PLAY';
  else if (!RATED_REASONS.has(reason)) excludedReason = 'ADMINISTRATIVE_RESULT';
  else if (!Number.isSafeInteger(moveCount) || moveCount < 2) excludedReason = 'INSUFFICIENT_PLAY';
  const record = { gameId, whitePlayerId, blackPlayerId, outcome, reason, moveCount, completedAt,
    tournamentId: game.tournamentId ?? null, matchId: game.matchId ?? null,
    policyVersion: POLICY.version, fingerprint, rated: !excludedReason, excludedReason };
  if (!excludedReason) {
    const white = structuredClone(profile(state, whitePlayerId));
    const black = structuredClone(profile(state, blackPlayerId));
    const change = calculate(white.rating, black.rating, outcome);
    record.white = { before: white.rating, after: change.whiteAfter, delta: change.whiteDelta, expected: change.expectedWhite };
    record.black = { before: black.rating, after: change.blackAfter, delta: change.blackDelta, expected: 1 - change.expectedWhite };
    for (const [side, player] of [['white', white], ['black', black]]) {
      player.rating = record[side].after; player.ratedGames++; player.updatedAt = completedAt;
      const points = side === 'white' ? OUTCOMES[outcome] : 1 - OUTCOMES[outcome];
      player[points === 1 ? 'wins' : points === 0 ? 'losses' : 'draws']++;
      Object.defineProperty(state.ratings, player.playerId, { value: player, enumerable: true, writable: true, configurable: true });
    }
  }
  Object.defineProperty(state.ratingResults, gameId, { value: record, enumerable: true, writable: true, configurable: true });
  return record;
}
class RatingService {
  constructor(store) { this.store = store; }
  get(playerId) { return this.store.read(state => ({ ...profile(state, playerId), policy: POLICY })); }
  history(playerId, { limit = 20, offset = 0 } = {}) {
    requireThat(validPlayer(playerId), 'INVALID_PLAYER', 'Invalid player identity', 400);
    requireThat(Number.isInteger(limit) && limit > 0 && limit <= 100 && Number.isInteger(offset) && offset >= 0,
      'INVALID_PAGINATION', 'limit must be 1–100 and offset must be nonnegative', 400);
    return this.store.read(state => {
      const rows = Object.values(state.ratingResults ?? {}).filter(r => r.rated &&
        (r.whitePlayerId === playerId || r.blackPlayerId === playerId)).reverse();
      return { total: rows.length, limit, offset, games: rows.slice(offset, offset + limit).map(r => {
        const side = r.whitePlayerId === playerId ? 'white' : 'black';
        return { gameId: r.gameId, tournamentId: r.tournamentId,
          tournamentName: state.tournaments[r.tournamentId]?.name ?? null, matchId: r.matchId,
          opponentId: side === 'white' ? r.blackPlayerId : r.whitePlayerId, side,
          score: side === 'white' ? OUTCOMES[r.outcome] : 1 - OUTCOMES[r.outcome],
          reason: r.reason, completedAt: r.completedAt, policyVersion: r.policyVersion, ...r[side] };
      }) };
    });
  }
  settle(game) { return this.store.transaction(state => settle(state, game)); }
}
module.exports = { POLICY, expectedScore, calculate, profile, settle, RatingService, validateStorage };
