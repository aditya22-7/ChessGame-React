const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../games/engine');
const { fixture } = require('./helpers');

test('king-capture completion records final board and replays identically after recovery', () => {
  const f = fixture(2, 1), m = f.start().matches[0];
  const sequence = [
    [[1, 4], [3, 4]], [[6, 0], [5, 0]], [[0, 4], [2, 4]],
    [[6, 7], [5, 7]], [[2, 4], [5, 1]], [[5, 0], [4, 0]],
    [[5, 1], [6, 2]], [[5, 7], [4, 7]], [[6, 2], [7, 3]],
  ];
  let response;
  sequence.forEach(([from, to], i) => {
    response = f.service.command(f.tournament.id, m.id,
      f.owner(m[i % 2 === 0 ? 'whiteEntrantId' : 'blackEntrantId']), {
        commandId: 'move-' + i, type: 'MOVE', expectedMoveSequence: i,
        from: { row: from[0], col: from[1] }, to: { row: to[0], col: to[1] },
      });
  });
  assert.equal(response.result.outcome, 'WHITE_WIN');
  assert.equal(response.result.reason, 'GAME_COMPLETED');
  assert.equal(response.board[0][3], '♕');
  const journal = f.raw().rounds[0].matches[0].game.moves;
  assert.deepEqual(engine.view(engine.restore(journal)).board, response.board);
  assert.equal(f.raw().status, 'COMPLETED');
});
test('invalid coordinates and empty source never mutate a replayed game', () => {
  const game = engine.restore([]), original = engine.view(game);
  for (const from of [null, { row: -1, col: 0 }, { row: 0.5, col: 0 }, { row: 3, col: 3 }]) {
    assert.throws(() => engine.apply(game, { from, to: { row: 3, col: 0 } }));
    assert.deepEqual(engine.view(game), original);
  }
});
