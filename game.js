const BOARD_SIZES = [15, 19, 21, 25];
const TIME_LIMITS = [5, 10, 15, 0];
const DIRECTIONS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];

const DEFAULT_SETTINGS = Object.freeze({
  boardSize: 15,
  timeMinutes: 5,
  forbidden: Object.freeze({ doubleThree: true, doubleFour: true, overline: true })
});

function normalizeSettings(value = {}) {
  const boardSize = BOARD_SIZES.includes(Number(value.boardSize)) ? Number(value.boardSize) : DEFAULT_SETTINGS.boardSize;
  const timeMinutes = TIME_LIMITS.includes(Number(value.timeMinutes)) ? Number(value.timeMinutes) : DEFAULT_SETTINGS.timeMinutes;
  const forbidden = value.forbidden && typeof value.forbidden === "object" ? value.forbidden : {};
  return {
    boardSize,
    timeMinutes,
    forbidden: {
      doubleThree: forbidden.doubleThree !== false,
      doubleFour: forbidden.doubleFour !== false,
      overline: forbidden.overline !== false
    }
  };
}

function createBoard(size = DEFAULT_SETTINGS.boardSize) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function createGame(rawSettings) {
  const settings = normalizeSettings(rawSettings);
  const initialTime = settings.timeMinutes === 0 ? null : settings.timeMinutes * 60 * 1000;
  return {
    settings,
    board: createBoard(settings.boardSize),
    turn: 1,
    winner: 0,
    winningLine: [],
    moveCount: 0,
    lastMove: null,
    clocks: { 1: initialTime, 2: initialTime },
    turnStartedAt: null,
    rematchVotes: new Set()
  };
}

function inBounds(board, value) {
  return Number.isInteger(value) && value >= 0 && value < board.length;
}

function getLine(board, row, col, color, rowStep, colStep) {
  const cells = [{ row, col }];
  for (const direction of [-1, 1]) {
    let nextRow = row + rowStep * direction;
    let nextCol = col + colStep * direction;
    while (
      inBounds(board, nextRow) &&
      inBounds(board, nextCol) &&
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
  for (const [rowStep, colStep] of DIRECTIONS) {
    const line = getLine(board, row, col, color, rowStep, colStep);
    if (line.length >= 5) return line;
  }
  return [];
}

function directionalString(board, row, col, rowStep, colStep) {
  let text = "";
  for (let offset = -5; offset <= 5; offset += 1) {
    const currentRow = row + offset * rowStep;
    const currentCol = col + offset * colStep;
    text += inBounds(board, currentRow) && inBounds(board, currentCol)
      ? String(board[currentRow][currentCol])
      : "2";
  }
  return text;
}

function patternIncludesMove(text, pattern, centerIndex = 5) {
  for (let start = 0; start <= text.length - pattern.length; start += 1) {
    if (text.slice(start, start + pattern.length) !== pattern) continue;
    const position = centerIndex - start;
    if (position >= 0 && position < pattern.length && pattern[position] === "1") return true;
  }
  return false;
}

function createsOpenThree(text) {
  return ["01110", "010110", "011010"].some((pattern) => patternIncludesMove(text, pattern));
}

function createsFour(text, centerIndex = 5) {
  for (let start = 0; start <= text.length - 5; start += 1) {
    const window = text.slice(start, start + 5);
    const centerPosition = centerIndex - start;
    if (centerPosition < 0 || centerPosition >= 5 || window[centerPosition] !== "1") continue;
    if (!window.includes("2") && window.split("1").length - 1 === 4) return true;
  }
  return false;
}

function forbiddenReason(board, row, col, rules) {
  const lines = DIRECTIONS.map(([rowStep, colStep]) => ({
    cells: getLine(board, row, col, 1, rowStep, colStep),
    text: directionalString(board, row, col, rowStep, colStep)
  }));

  if (rules.overline && lines.some(({ cells }) => cells.length >= 6)) {
    return "长连禁手：黑棋不能形成六枚或更多连续棋子";
  }
  // An exact five wins immediately unless the same move also makes a forbidden overline.
  if (lines.some(({ cells }) => cells.length >= 5)) return null;
  if (rules.doubleFour && lines.filter(({ text }) => createsFour(text)).length >= 2) {
    return "四四禁手：黑棋不能一手同时形成两个四";
  }
  if (rules.doubleThree && lines.filter(({ text }) => createsOpenThree(text)).length >= 2) {
    return "三三禁手：黑棋不能一手同时形成两个活三";
  }
  return null;
}

function applyMove(game, row, col, color) {
  const size = game.board.length;
  if (
    game.winner ||
    game.turn !== color ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 || col < 0 || row >= size || col >= size
  ) {
    return { ok: false, reason: "现在不能在这里落子" };
  }
  if (game.board[row][col] !== 0) return { ok: false, reason: "这个位置已经有棋子了" };

  game.board[row][col] = color;
  if (color === 1) {
    const reason = forbiddenReason(game.board, row, col, game.settings.forbidden);
    if (reason) {
      game.board[row][col] = 0;
      return { ok: false, reason };
    }
  }

  game.moveCount += 1;
  game.lastMove = { row, col };
  game.winningLine = findWinningLine(game.board, row, col, color);
  if (game.winningLine.length) game.winner = color;
  else if (game.moveCount === size * size) game.winner = 3;
  else game.turn = color === 1 ? 2 : 1;
  return { ok: true };
}

module.exports = {
  BOARD_SIZES,
  TIME_LIMITS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  createBoard,
  createGame,
  findWinningLine,
  forbiddenReason,
  applyMove
};
