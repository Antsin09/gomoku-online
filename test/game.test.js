const test = require("node:test");
const assert = require("node:assert/strict");
const { createGame, applyMove, findWinningLine, forbiddenReason, normalizeSettings } = require("../game");

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

test("normalizes room settings and creates different board and clock sizes", () => {
  const large = createGame({ boardSize: 21, timeMinutes: 10 });
  assert.equal(large.board.length, 21);
  assert.equal(large.clocks[1], 10 * 60 * 1000);

  const untimed = createGame({ boardSize: 25, timeMinutes: 0 });
  assert.equal(untimed.board.length, 25);
  assert.equal(untimed.clocks[1], null);
  assert.equal(normalizeSettings({ boardSize: 99, timeMinutes: 3 }).boardSize, 15);
});

test("detects a black double-three", () => {
  const game = createGame();
  const { board } = game;
  board[7][6] = board[7][8] = board[6][7] = board[8][7] = board[7][7] = 1;
  assert.match(forbiddenReason(board, 7, 7, game.settings.forbidden), /三三禁手/);
});

test("detects a black double-four", () => {
  const game = createGame();
  const { board } = game;
  for (const [row, col] of [[7,5], [7,6], [7,8], [5,7], [6,7], [8,7], [7,7]]) board[row][col] = 1;
  assert.match(forbiddenReason(board, 7, 7, game.settings.forbidden), /四四禁手/);
});

test("detects two distinct fours formed on the same line", () => {
  const game = createGame();
  const { board } = game;
  for (const col of [4, 6, 7, 8, 10]) board[7][col] = 1;
  assert.match(forbiddenReason(board, 7, 7, game.settings.forbidden), /四四禁手/);
});

test("allows a four-three and does not count its pseudo-three as a real three", () => {
  const game = createGame();
  const { board } = game;
  // Horizontally this move makes 0-111-0-1: one Four plus an apparent Three.
  // Extending the apparent Three on the left would itself make a double-Four,
  // so RIF rules classify it as a pseudo-three. Vertically there is one real
  // Three. The whole move is therefore a legal four-three, not a double-three.
  for (const [row, col] of [[7,5], [7,6], [7,9], [6,7], [8,7], [7,7]]) board[row][col] = 1;
  assert.equal(forbiddenReason(board, 7, 7, game.settings.forbidden), null);
});

test("does not count a three trapped against the board edge", () => {
  const game = createGame();
  const { board } = game;
  for (const [row, col] of [[1,6], [1,8], [0,7], [2,7], [1,7]]) board[row][col] = 1;
  assert.equal(forbiddenReason(board, 1, 7, game.settings.forbidden), null);
});

test("an exact five takes priority over simultaneous forbidden patterns", () => {
  const game = createGame();
  const { board } = game;
  for (const [row, col] of [
    [7,5], [7,6], [7,8], [7,9],
    [6,7], [8,7], [6,6], [8,8],
    [7,7]
  ]) board[row][col] = 1;
  assert.equal(forbiddenReason(board, 7, 7, game.settings.forbidden), null);
});

test("rejects an enabled overline and rolls back the move", () => {
  const game = createGame();
  for (let col = 2; col <= 6; col += 1) game.board[7][col] = 1;
  const result = applyMove(game, 7, 7, 1);
  assert.equal(result.ok, false);
  assert.match(result.reason, /长连禁手/);
  assert.equal(game.board[7][7], 0);
  assert.equal(game.turn, 1);
});

test("allows the same shape when its forbidden rule is disabled", () => {
  const game = createGame({
    forbidden: { doubleThree: false, doubleFour: false, overline: false }
  });
  for (let col = 2; col <= 6; col += 1) game.board[7][col] = 1;
  const result = applyMove(game, 7, 7, 1);
  assert.equal(result.ok, true);
  assert.equal(game.winner, 1);
});
