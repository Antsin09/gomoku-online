const socket = io();
const $ = (selector) => document.querySelector(selector);
const canvas = $("#board");
const ctx = canvas.getContext("2d");
const SIZE = 15;

let state = null;
let moveCount = 0;
let lastWinner = 0;
let toastTimer;

function makePlayerId() {
  let id = localStorage.getItem("gomoku-player-id");
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    localStorage.setItem("gomoku-player-id", id);
  }
  return id;
}

const playerId = makePlayerId();
const savedName = localStorage.getItem("gomoku-name") || "";
$("#nameInput").value = savedName;

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) $("#roomInput").value = roomFromUrl.toUpperCase();

function nameValue() {
  const name = $("#nameInput").value.trim();
  if (!name) {
    $("#lobbyError").textContent = "请先输入你的昵称";
    $("#nameInput").focus();
    return null;
  }
  localStorage.setItem("gomoku-name", name);
  return name;
}

function setLobbyBusy(busy) {
  $("#createButton").disabled = busy;
  $("#joinForm button").disabled = busy;
}

function enterRoom(code) {
  history.replaceState({}, "", `/?room=${code}`);
  $("#roomCode").textContent = code;
  $("#lobby").classList.add("hidden");
  $("#game").classList.remove("hidden");
  requestAnimationFrame(resizeCanvas);
}

$("#createButton").addEventListener("click", () => {
  const name = nameValue();
  if (!name) return;
  setLobbyBusy(true);
  socket.emit("create_room", { playerId, name }, (result) => {
    setLobbyBusy(false);
    if (result.ok) enterRoom(result.code);
    else $("#lobbyError").textContent = result.message;
  });
});

$("#joinForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameValue();
  const code = $("#roomInput").value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 6) {
    $("#lobbyError").textContent = "请输入六位房间号";
    return;
  }
  setLobbyBusy(true);
  socket.emit("join_room", { playerId, name, code }, (result) => {
    setLobbyBusy(false);
    if (result.ok) enterRoom(result.code);
    else $("#lobbyError").textContent = result.message;
  });
});

$("#roomInput").addEventListener("input", (event) => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
});

function countMoves(board) {
  return board.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
}

socket.on("state", (nextState) => {
  const previousMoves = moveCount;
  state = nextState;
  moveCount = countMoves(state.board);
  render();
  if (moveCount > previousMoves && state.lastMove) drawBoard(true);
  if (state.winner && state.winner !== lastWinner) showResult();
  lastWinner = state.winner;
});

socket.on("connect", () => {
  $("#connectionStatus").classList.remove("offline");
  $("#connectionStatus").lastChild.textContent = "已连接";
  const code = new URLSearchParams(location.search).get("room");
  const name = localStorage.getItem("gomoku-name");
  if (code && name && $("#lobby").classList.contains("hidden")) {
    socket.emit("join_room", { playerId, name, code });
  }
});

socket.on("disconnect", () => {
  $("#connectionStatus").classList.add("offline");
  $("#connectionStatus").lastChild.textContent = "连接中断";
});

socket.on("session_replaced", () => {
  toast("这个玩家身份已在另一个页面打开");
  setTimeout(() => location.reload(), 1200);
});

function render() {
  if (!state) return;
  $("#roomCode").textContent = state.code;
  $("#myColor").textContent = state.myColor === 1 ? "黑棋" : "白棋";
  $("#moveNumber").textContent = moveCount;
  $("#blackClock").textContent = formatTime(state.clocks[1]);
  $("#whiteClock").textContent = formatTime(state.clocks[2]);
  renderPlayer(1, $("#blackPlayer"));
  renderPlayer(2, $("#whitePlayer"));

  const waiting = !state.ready;
  $("#boardWrap").classList.toggle("waiting", waiting);
  $("#waitingOverlay").classList.toggle("hidden", !waiting);

  const status = $("#statusText");
  const turnStone = $("#turnStone");
  turnStone.className = `mini-stone ${state.turn === 1 ? "black" : "white"}`;
  if (waiting) status.textContent = "等待好友加入";
  else if (state.winner === 3) status.textContent = "本局平局";
  else if (state.winner) status.textContent = `${state.winner === 1 ? "黑棋" : "白棋"}获胜`;
  else status.textContent = state.turn === state.myColor ? "轮到你了" : "等待对方落子";

  const finished = Boolean(state.winner);
  $("#rematchButton").disabled = !finished;
  $("#rematchButton").textContent = state.rematchVotes === 1 ? "等待对方同意…" : "再来一局";
  drawBoard();
}

function renderPlayer(color, element) {
  const player = state.players[color - 1];
  element.querySelector("strong").textContent = player?.name || "等待加入…";
  element.classList.toggle("active", state.ready && !state.winner && state.turn === color);
  element.classList.toggle("disconnected", Boolean(player && !player.connected));
}

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  drawBoard();
}

function drawBoard(animateLast = false) {
  if (!state || !canvas.width) return;
  const width = canvas.width;
  const padding = width * 0.045;
  const gap = (width - padding * 2) / (SIZE - 1);
  ctx.clearRect(0, 0, width, width);
  ctx.strokeStyle = "rgba(47, 36, 24, .7)";
  ctx.lineWidth = Math.max(1, width / 700);

  for (let index = 0; index < SIZE; index += 1) {
    const point = padding + gap * index;
    ctx.beginPath();
    ctx.moveTo(padding, point);
    ctx.lineTo(width - padding, point);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point, padding);
    ctx.lineTo(point, width - padding);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(47, 36, 24, .75)";
  for (const [row, col] of [[3,3], [3,11], [7,7], [11,3], [11,11]]) {
    ctx.beginPath();
    ctx.arc(padding + col * gap, padding + row * gap, gap * .08, 0, Math.PI * 2);
    ctx.fill();
  }

  const winning = new Set(state.winningLine.map(({ row, col }) => `${row}-${col}`));
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const color = state.board[row][col];
      if (!color) continue;
      const isLast = state.lastMove?.row === row && state.lastMove?.col === col;
      drawStone(
        padding + col * gap,
        padding + row * gap,
        gap * .41,
        color,
        winning.has(`${row}-${col}`),
        isLast,
        isLast && animateLast
      );
    }
  }
}

function drawStone(x, y, radius, color, isWinner, isLast, animate) {
  const effectiveRadius = animate ? radius * .96 : radius;
  ctx.save();
  ctx.shadowColor = "rgba(30,22,14,.34)";
  ctx.shadowBlur = radius * .42;
  ctx.shadowOffsetY = radius * .18;
  const gradient = ctx.createRadialGradient(x - radius * .32, y - radius * .35, radius * .08, x, y, radius);
  if (color === 1) {
    gradient.addColorStop(0, "#555");
    gradient.addColorStop(.42, "#202020");
    gradient.addColorStop(1, "#050505");
  } else {
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(.55, "#f3f2ee");
    gradient.addColorStop(1, "#c8c5bd");
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, effectiveRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (isWinner) {
    ctx.strokeStyle = color === 1 ? "#e4c66a" : "#315f46";
    ctx.lineWidth = Math.max(2, radius * .12);
    ctx.stroke();
  }
  if (isLast && !isWinner) {
    ctx.fillStyle = color === 1 ? "rgba(255,255,255,.78)" : "rgba(30,30,28,.66)";
    ctx.beginPath();
    ctx.arc(x, y, radius * .16, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

canvas.addEventListener("pointerup", (event) => {
  if (!state?.ready || state.winner || state.turn !== state.myColor) return;
  const rect = canvas.getBoundingClientRect();
  const visualX = (event.clientX - rect.left) * (canvas.width / rect.width);
  const visualY = (event.clientY - rect.top) * (canvas.height / rect.height);
  const padding = canvas.width * .045;
  const gap = (canvas.width - padding * 2) / (SIZE - 1);
  const col = Math.round((visualX - padding) / gap);
  const row = Math.round((visualY - padding) / gap);
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
  socket.emit("move", { row, col }, (result) => {
    if (!result.ok) showGameError(result.message);
  });
});

function showGameError(message) {
  $("#gameError").textContent = message;
  setTimeout(() => { $("#gameError").textContent = ""; }, 2200);
}

function showResult() {
  const modal = $("#resultModal");
  const stone = $("#resultStone");
  const isDraw = state.winner === 3;
  stone.className = `result-stone ${state.winner === 2 ? "white" : "black"}`;
  stone.classList.toggle("hidden", isDraw);
  $("#resultTitle").textContent = isDraw ? "本局平局" : `${state.winner === 1 ? "黑棋" : "白棋"}获胜`;
  $("#resultSubtitle").textContent = isDraw ? "棋逢对手，再来一局？" : state.winner === state.myColor ? "漂亮的一局，你赢了。" : "胜负已分，再来一局？";
  modal.classList.remove("hidden");
}

function requestRematch() {
  socket.emit("rematch", (result) => {
    if (result.ok) {
      $("#resultModal").classList.add("hidden");
      toast("已邀请对方再来一局");
    }
  });
}

$("#rematchButton").addEventListener("click", requestRematch);
$("#modalRematchButton").addEventListener("click", requestRematch);
$("#closeModalButton").addEventListener("click", () => $("#resultModal").classList.add("hidden"));

function invitationUrl() {
  return `${location.origin}/?room=${state?.code || $("#roomCode").textContent}`;
}

async function copyInvitation() {
  const url = invitationUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast("邀请链接已复制");
  } catch {
    prompt("复制这个邀请链接", url);
  }
}

$("#copyButton").addEventListener("click", copyInvitation);
$("#shareButton").addEventListener("click", copyInvitation);
$("#overlayCopyButton").addEventListener("click", copyInvitation);
$("#exitButton").addEventListener("click", () => {
  socket.emit("leave_room");
  history.replaceState({}, "", "/");
  location.reload();
});

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 1800);
}

window.addEventListener("resize", resizeCanvas);
