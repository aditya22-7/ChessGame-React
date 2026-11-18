const { createNewGame } = require('../../game');
const { requireThat } = require('../tournaments/errors');

function coordinate(value) {
  return value && Number.isInteger(value.row) && Number.isInteger(value.col) &&
    value.row >= 0 && value.row < 8 && value.col >= 0 && value.col < 8;
}
/** Replays a durable move journal, preserving the existing engine's piece histories.
 * Coordinates are engine coordinates: row 0 = rank 1. This is the legacy
 * king-capture ruleset, not a claim of standard/FIDE chess legality.
 */
function restore(moves) {
  const game = createNewGame();
  for (const move of moves) apply(game, move);
  return game;
}
function apply(game, move) {
  requireThat(coordinate(move.from) && coordinate(move.to), 'INVALID_MOVE', 'Invalid coordinates', 400);
  requireThat(!game.status, 'GAME_OVER', 'Game already ended');
  const from = game.board.getTile(move.from.row, move.from.col);
  const to = game.board.getTile(move.to.row, move.to.col);
  requireThat(from.piece && from.piece.color === game.turn &&
    from.piece.permittedTiles.includes(to), 'ILLEGAL_MOVE', 'Move is not permitted');
  const ret = game.move(from, to);
  requireThat(ret !== false || game.status, 'ILLEGAL_MOVE', 'Move rejected');
  // The legacy engine reports king capture before moving the winning piece.
  // Finish that terminal board transition in the tournament adapter only.
  if (game.status && from.piece) {
    const piece = from.piece;
    to.piece = piece; from.piece = null; piece.tile = to;
    piece.history.push(to);
  }
  return game;
}
function view(game) { return { board: game.getBoard(), turn: game.turn ? 'white' : 'black', winner: game.status }; }
module.exports = { restore, apply, view, coordinate, ruleset: 'legacy-king-capture-v1' };
