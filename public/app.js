const socket = io();
const $ = (selector) => document.querySelector(selector);
const canvas = $("#board");
const ctx = canvas.getContext("2d");

let state = null;
let moveCount = 0;
let lastWinner = 0;
let toastTimer;
let boardZoom = Math.min(200, Math.max(60, Number(localStorage.getItem("gomoku-board-zoom")) || 100));

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
  requestAnimationFrame(applyBoardZoom);
}

function selectedSettings() {
  return {
    timeMinutes: Number(document.querySelector('input[name="timeLimit"]:checked').value),
    boardSize: Number(document.querySelector('input[name="boardSize"]:checked').value),
    forbidden: {
      doubleThree: $("#doubleThree").checked,
      doubleFour: $("#doubleFour").checked,
      overline: $("#overline").checked
    }
  };
}

$("#createButton").addEventListener("click", () => {
  const name = nameValue();
  if (!name) return;
  setLobbyBusy(true);
  socket.emit("create_room", { playerId, name, settings: selectedSettings() }, (result) => {
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
  canvas.setAttribute("aria-label", `${state.settings.boardSize}乘${state.settings.boardSize}五子棋棋盘`);
  renderSettings();
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

function forbiddenLabels() {
  const rules = state.settings.forbidden;
  const labels = [];
  if (rules.doubleThree) labels.push("三三");
  if (rules.doubleFour) labels.push("四四");
  if (rules.overline) labels.push("长连");
  return labels;
}

function renderSettings() {
  const timeLabel = state.settings.timeMinutes === 0 ? "不限时" : `每方 ${state.settings.timeMinutes} 分钟`;
  const forbidden = forbiddenLabels();
  $("#settingChips").innerHTML = [
    boardSizeLabel(state.settings.boardSize),
    timeLabel,
    forbidden.length ? `黑棋禁手：${forbidden.join("、")}` : "自由规则"
  ].map((label) => `<span>${label}</span>`).join("");
  $("#ruleText").textContent = forbidden.length
    ? `黑棋启用${forbidden.join("、")}禁手；白棋无禁手。率先连成五子获胜。`
    : "双方均无禁手，率先连成五子或更多即可获胜。";
}

function boardSizeLabel(size) {
  const names = { 15: "标准", 19: "大型", 21: "超大型", 25: "巨型" };
  return `${size} × ${size} · ${names[size] || "自定义"}`;
}

function renderPlayer(color, element) {
  const player = state.players[color - 1];
  element.querySelector("strong").textContent = player?.name || "等待加入…";
  element.classList.toggle("active", state.ready && !state.winner && state.turn === color);
  element.classList.toggle("disconnected", Boolean(player && !player.connected));
}

function formatTime(milliseconds) {
  if (milliseconds === null) return "不限";
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

function applyBoardZoom() {
  const viewport = $("#boardViewport");
  const boardWrap = $("#boardWrap");
  if (!viewport.clientWidth) return;

  const oldWidth = Math.max(viewport.scrollWidth, 1);
  const oldHeight = Math.max(viewport.scrollHeight, 1);
  const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth;
  const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / oldHeight;
  const boardPixels = Math.round(viewport.clientWidth * boardZoom / 100);
  boardWrap.style.width = `${boardPixels}px`;
  const verticalMargin = Math.max(0, Math.round((viewport.clientWidth - boardPixels) / 2));
  boardWrap.style.marginTop = `${verticalMargin}px`;
  boardWrap.style.marginBottom = `${verticalMargin}px`;
  $("#zoomSlider").value = String(boardZoom);
  $("#zoomValue").textContent = `${boardZoom}%`;

  requestAnimationFrame(() => {
    resizeCanvas();
    viewport.scrollLeft = Math.max(0, centerX * viewport.scrollWidth - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, centerY * viewport.scrollHeight - viewport.clientHeight / 2);
  });
}

function setBoardZoom(value) {
  boardZoom = Math.min(200, Math.max(60, Math.round(Number(value) / 10) * 10));
  localStorage.setItem("gomoku-board-zoom", String(boardZoom));
  applyBoardZoom();
}

$("#zoomSlider").addEventListener("input", (event) => setBoardZoom(event.target.value));
$("#zoomOutButton").addEventListener("click", () => setBoardZoom(boardZoom - 10));
$("#zoomInButton").addEventListener("click", () => setBoardZoom(boardZoom + 10));

function drawBoard(animateLast = false) {
  if (!state || !canvas.width) return;
  const size = state.board.length;
  const width = canvas.width;
  const padding = width * 0.045;
  const gap = (width - padding * 2) / (size - 1);
  ctx.clearRect(0, 0, width, width);
  ctx.strokeStyle = "rgba(47, 36, 24, .7)";
  ctx.lineWidth = Math.max(1, width / 700);

  for (let index = 0; index < size; index += 1) {
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
  for (const [row, col] of starPoints(size)) {
    ctx.beginPath();
    ctx.arc(padding + col * gap, padding + row * gap, gap * .08, 0, Math.PI * 2);
    ctx.fill();
  }

  const winning = new Set(state.winningLine.map(({ row, col }) => `${row}-${col}`));
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
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

function starPoints(size) {
  if (size >= 19) {
    const center = (size - 1) / 2;
    const points = [3, center, size - 4];
    return points.flatMap((row) => points.map((col) => [row, col]));
  }
  const edge = 3;
  const far = size - 4;
  const center = (size - 1) / 2;
  return [[edge, edge], [edge, far], [center, center], [far, edge], [far, far]];
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
  const size = state.board.length;
  const rect = canvas.getBoundingClientRect();
  const visualX = (event.clientX - rect.left) * (canvas.width / rect.width);
  const visualY = (event.clientY - rect.top) * (canvas.height / rect.height);
  const padding = canvas.width * .045;
  const gap = (canvas.width - padding * 2) / (size - 1);
  const col = Math.round((visualX - padding) / gap);
  const row = Math.round((visualY - padding) / gap);
  if (row < 0 || row >= size || col < 0 || col >= size) return;
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

window.addEventListener("resize", applyBoardZoom);
