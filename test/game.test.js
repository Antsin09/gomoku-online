const test = require("node:test");
const assert = require("node:assert/strict");
const { createGame, applyMove, findWinningLine } = require("../game");

test("new game starts with black and an empty board", () => {
  const game = createGame();
  assert.equal(game.turn, 1);
  assert.equal(game.board.flat().every((cell) => cell === 0), true);
});

test("players must alternate and cannot reuse a point", () => {
  const game = createGame();
  assert.equal(applyMove(game, 7, 7, 2).ok, false);
  assert.equal(applyMove(game, 7, 7, 1).ok, true);
  assert.equal(applyMove(game, 7, 7, 2).ok, false);
  assert.equal(applyMove(game, 7, 8, 2).ok, true);
});

test("detects horizontal, vertical and both diagonal wins", () => {
  const cases = [
    Array.from({ length: 5 }, (_, col) => [5, col]),
    Array.from({ length: 5 }, (_, row) => [row, 5]),
    Array.from({ length: 5 }, (_, index) => [index, index]),
    Array.from({ length: 5 }, (_, index) => [index, 8 - index])
  ];
  for (const cells of cases) {
    const board = Array.from({ length: 15 }, () => Array(15).fill(0));
    for (const [row, col] of cells) board[row][col] = 1;
    const [row, col] = cells[2];
    assert.equal(findWinningLine(board, row, col, 1).length, 5);
  }
});

test("applies a real five-in-a-row game and records the winner", () => {
  const game = createGame();
  for (let col = 0; col < 4; col += 1) {
    assert.equal(applyMove(game, 4, col, 1).ok, true);
    assert.equal(applyMove(game, 10, col, 2).ok, true);
  }
  assert.equal(applyMove(game, 4, 4, 1).ok, true);
  assert.equal(game.winner, 1);
  assert.equal(game.winningLine.length, 5);
  assert.equal(applyMove(game, 8, 8, 2).ok, false);
});
