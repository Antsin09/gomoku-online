const BOARD_SIZE = 15;
const INITIAL_TIME = 5 * 60 * 1000;

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function createGame() {
  return {
    board: createBoard(),
    turn: 1,
    winner: 0,
    winningLine: [],
    moveCount: 0,
    lastMove: null,
    clocks: { 1: INITIAL_TIME, 2: INITIAL_TIME },
    turnStartedAt: null,
    rematchVotes: new Set()
  };
}

function inBounds(value) {
  return Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

function getLine(board, row, col, color, rowStep, colStep) {
  const cells = [{ row, col }];

  for (const direction of [-1, 1]) {
    let nextRow = row + rowStep * direction;
    let nextCol = col + colStep * direction;
    while (
      inBounds(nextRow) &&
      inBounds(nextCol) &&
      board[nextRow][nextCol] === color
    ) {
      if (direction === -1) cells.unshift({ row: nextRow, col: nextCol });
      else cells.push({ row: nextRow, col: nextCol });
      nextRow += rowStep * direction;
      nextCol += colStep * direction;
    }
  }

  return cells;
}

function findWinningLine(board, row, col, color) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (const [rowStep, colStep] of directions) {
    const line = getLine(board, row, col, color, rowStep, colStep);
    if (line.length >= 5) return line;
  }
  return [];
}

function applyMove(game, row, col, color) {
  if (game.winner || game.turn !== color || !inBounds(row) || !inBounds(col)) {
    return { ok: false, reason: "现在不能在这里落子" };
  }
  if (game.board[row][col] !== 0) {
    return { ok: false, reason: "这个位置已经有棋子了" };
  }

  game.board[row][col] = color;
  game.moveCount += 1;
  game.lastMove = { row, col };
  game.winningLine = findWinningLine(game.board, row, col, color);

  if (game.winningLine.length) game.winner = color;
  else if (game.moveCount === BOARD_SIZE * BOARD_SIZE) game.winner = 3;
  else game.turn = color === 1 ? 2 : 1;

  return { ok: true };
}

module.exports = {
  BOARD_SIZE,
  INITIAL_TIME,
  createBoard,
  createGame,
  findWinningLine,
  applyMove
};
