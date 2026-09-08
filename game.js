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

function pointKey({ row, col }) {
  return `${row},${col}`;
}

function lineThrough(board, row, col, rowStep, colStep) {
  let firstRow = row;
  let firstCol = col;
  while (inBounds(board, firstRow - rowStep) && inBounds(board, firstCol - colStep)) {
    firstRow -= rowStep;
    firstCol -= colStep;
  }

  const cells = [];
  let originIndex = -1;
  for (
    let currentRow = firstRow, currentCol = firstCol;
    inBounds(board, currentRow) && inBounds(board, currentCol);
    currentRow += rowStep, currentCol += colStep
  ) {
    if (currentRow === row && currentCol === col) originIndex = cells.length;
    cells.push({ row: currentRow, col: currentCol });
  }
  return { cells, originIndex, rowStep, colStep };
}

function runLengthInDirection(board, row, col, rowStep, colStep) {
  return getLine(board, row, col, 1, rowStep, colStep).length;
}

function hasExactFive(board, row, col) {
  return DIRECTIONS.some(
    ([rowStep, colStep]) => runLengthInDirection(board, row, col, rowStep, colStep) === 5
  );
}

function hasOverline(board, row, col) {
  return DIRECTIONS.some(
    ([rowStep, colStep]) => runLengthInDirection(board, row, col, rowStep, colStep) >= 6
  );
}

function completesFiveInDirection(board, point, rowStep, colStep, rules) {
  board[point.row][point.col] = 1;
  const length = runLengthInDirection(board, point.row, point.col, rowStep, colStep);
  board[point.row][point.col] = 0;
  return rules.overline ? length === 5 : length >= 5;
}

// A Four is a distinct set of four black stones, including the new move, that
// has at least one legal completion to five. The two ends of one straight Four
// are deliberately deduplicated, while two different Fours on the same line
// are still counted separately.
function findFourStructures(board, row, col, rules) {
  const structures = new Map();
  for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex += 1) {
    const [rowStep, colStep] = DIRECTIONS[directionIndex];
    const { cells, originIndex } = lineThrough(board, row, col, rowStep, colStep);
    const firstStart = Math.max(0, originIndex - 4);
    const lastStart = Math.min(originIndex, cells.length - 5);

    for (let start = firstStart; start <= lastStart; start += 1) {
      const window = cells.slice(start, start + 5);
      const black = window.filter((point) => board[point.row][point.col] === 1);
      const empty = window.filter((point) => board[point.row][point.col] === 0);
      if (black.length !== 4 || empty.length !== 1) continue;
      if (!black.some((point) => point.row === row && point.col === col)) continue;
      if (!completesFiveInDirection(board, empty[0], rowStep, colStep, rules)) continue;

      const stones = black.map(pointKey).sort();
      const key = `${directionIndex}:${stones.join("|")}`;
      if (!structures.has(key)) structures.set(key, { directionIndex, stones, completions: new Set() });
      structures.get(key).completions.add(pointKey(empty[0]));
    }
  }
  return [...structures.values()];
}

function isLegalWinningEnd(board, point, rowStep, colStep, rules) {
  if (board[point.row][point.col] !== 0) return false;
  return completesFiveInDirection(board, point, rowStep, colStep, rules);
}

function findStraightFours(board, row, col, requiredPoint, rules) {
  const structures = new Map();
  for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex += 1) {
    const [rowStep, colStep] = DIRECTIONS[directionIndex];
    const { cells, originIndex } = lineThrough(board, row, col, rowStep, colStep);
    const requiredIndex = cells.findIndex(
      (point) => point.row === requiredPoint.row && point.col === requiredPoint.col
    );
    if (requiredIndex < 0) continue;

    const firstStart = Math.max(0, originIndex - 3, requiredIndex - 3);
    const lastStart = Math.min(originIndex, requiredIndex, cells.length - 4);
    for (let start = firstStart; start <= lastStart; start += 1) {
      const stones = cells.slice(start, start + 4);
      if (!stones.every((point) => board[point.row][point.col] === 1)) continue;
      const before = cells[start - 1];
      const after = cells[start + 4];
      if (!before || !after || board[before.row][before.col] !== 0 || board[after.row][after.col] !== 0) continue;
      if (!isLegalWinningEnd(board, before, rowStep, colStep, rules)) continue;
      if (!isLegalWinningEnd(board, after, rowStep, colStep, rules)) continue;

      const stoneKeys = stones.map(pointKey).sort();
      const key = `${directionIndex}:${stoneKeys.join("|")}`;
      structures.set(key, { directionIndex, stones: stoneKeys });
    }
  }
  return [...structures.values()];
}

function isValidThreeExtension(board, row, col, rules) {
  if (rules.overline && hasOverline(board, row, col)) return false;
  if (rules.doubleFour && findFourStructures(board, row, col, rules).length >= 2) return false;
  return true;
}

// Under the RIF definition a Three must have a continuation to a straight
// Four. We simulate every possible continuation instead of matching a list of
// text patterns. This rejects edge-bound threes and "pseudo-threes" whose only
// continuation would itself be an overline or a double-Four.
function findThreeStructures(board, row, col, rules) {
  const structures = new Map();
  for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex += 1) {
    const [rowStep, colStep] = DIRECTIONS[directionIndex];
    const { cells, originIndex } = lineThrough(board, row, col, rowStep, colStep);
    const firstCandidate = Math.max(0, originIndex - 4);
    const lastCandidate = Math.min(cells.length - 1, originIndex + 4);

    for (let candidateIndex = firstCandidate; candidateIndex <= lastCandidate; candidateIndex += 1) {
      const candidate = cells[candidateIndex];
      if (board[candidate.row][candidate.col] !== 0) continue;
      board[candidate.row][candidate.col] = 1;
      const straightFours = findStraightFours(board, row, col, candidate, rules)
        .filter((structure) => structure.directionIndex === directionIndex);
      const extensionIsValid = straightFours.length > 0 && isValidThreeExtension(
        board,
        candidate.row,
        candidate.col,
        rules
      );

      if (extensionIsValid) {
        for (const straightFour of straightFours) {
          const candidateKey = pointKey(candidate);
          const threeStones = straightFour.stones.filter((key) => key !== candidateKey);
          const key = `${directionIndex}:${threeStones.join("|")}`;
          if (!structures.has(key)) {
            structures.set(key, { directionIndex, stones: threeStones, extensions: new Set() });
          }
          structures.get(key).extensions.add(candidateKey);
        }
      }
      board[candidate.row][candidate.col] = 0;
    }
  }
  return [...structures.values()];
}

function forbiddenReason(board, row, col, rules) {
  // In official Renju, an exact five made by the same move takes precedence
  // over a simultaneously formed forbidden pattern. A run of six is not an
  // exact five, so it continues to the overline check below.
  if (hasExactFive(board, row, col)) return null;
  if (rules.overline && hasOverline(board, row, col)) {
    return "长连禁手：黑棋不能形成六枚或更多连续棋子";
  }
  if (rules.doubleFour && findFourStructures(board, row, col, rules).length >= 2) {
    return "四四禁手：黑棋不能一手同时形成两个四";
  }
  if (rules.doubleThree && findThreeStructures(board, row, col, rules).length >= 2) {
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
