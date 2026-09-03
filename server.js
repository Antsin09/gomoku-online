const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const { INITIAL_TIME, createGame, applyMove } = require("./game");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true }));

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function cleanName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
  return name || "棋手";
}

function connectedPlayers(room) {
  return room.players.filter((player) => player.connected);
}

function updateClock(room, now = Date.now()) {
  const game = room.game;
  if (game.winner || !game.turnStartedAt || connectedPlayers(room).length < 2) return;
  const elapsed = now - game.turnStartedAt;
  game.clocks[game.turn] = Math.max(0, game.clocks[game.turn] - elapsed);
  game.turnStartedAt = now;
  if (game.clocks[game.turn] === 0) {
    game.winner = game.turn === 1 ? 2 : 1;
    game.winningLine = [];
  }
}

function publicState(room, playerId) {
  updateClock(room);
  const me = room.players.find((player) => player.id === playerId);
  return {
    code: room.code,
    board: room.game.board,
    turn: room.game.turn,
    winner: room.game.winner,
    winningLine: room.game.winningLine,
    lastMove: room.game.lastMove,
    clocks: room.game.clocks,
    players: [1, 2].map((color) => {
      const player = room.players.find((item) => item.color === color);
      return player ? { name: player.name, color, connected: player.connected } : null;
    }),
    myColor: me?.color || 0,
    rematchVotes: room.game.rematchVotes.size,
    ready: connectedPlayers(room).length === 2
  };
}

function emitState(room) {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("state", publicState(room, player.id));
  }
}

function attachPlayer(socket, room, { playerId, name }) {
  let player = room.players.find((item) => item.id === playerId);
  if (player) {
    if (player.socketId && player.socketId !== socket.id) io.to(player.socketId).emit("session_replaced");
    player.name = cleanName(name);
    player.socketId = socket.id;
    player.connected = true;
  } else {
    if (room.players.length >= 2) return null;
    player = {
      id: playerId,
      name: cleanName(name),
      color: room.players.some((item) => item.color === 1) ? 2 : 1,
      socketId: socket.id,
      connected: true
    };
    room.players.push(player);
  }

  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.playerId = playerId;
  if (connectedPlayers(room).length === 2 && !room.game.turnStartedAt && !room.game.winner) {
    room.game.turnStartedAt = Date.now();
  }
  return player;
}

io.on("connection", (socket) => {
  socket.on("create_room", (payload = {}, reply = () => {}) => {
    const playerId = String(payload.playerId || "").slice(0, 64);
    if (!playerId) return reply({ ok: false, message: "无法识别玩家，请刷新后重试" });
    const code = makeRoomCode();
    const room = { code, players: [], game: createGame(), createdAt: Date.now() };
    rooms.set(code, room);
    attachPlayer(socket, room, { playerId, name: payload.name });
    reply({ ok: true, code });
    emitState(room);
  });

  socket.on("join_room", (payload = {}, reply = () => {}) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const playerId = String(payload.playerId || "").slice(0, 64);
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, message: "没有找到这个房间" });
    if (!playerId) return reply({ ok: false, message: "无法识别玩家，请刷新后重试" });
    const returning = room.players.some((player) => player.id === playerId);
    if (!returning && room.players.length >= 2) return reply({ ok: false, message: "这个房间已经满了" });
    attachPlayer(socket, room, { playerId, name: payload.name });
    reply({ ok: true, code });
    emitState(room);
  });

  socket.on("move", ({ row, col } = {}, reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.data.playerId);
    if (!room || !player) return reply({ ok: false, message: "你还没有加入房间" });
    updateClock(room);
    if (connectedPlayers(room).length < 2) return reply({ ok: false, message: "请等待另一位玩家加入" });
    const result = applyMove(room.game, Number(row), Number(col), player.color);
    if (!result.ok) return reply({ ok: false, message: result.reason });
    if (!room.game.winner) room.game.turnStartedAt = Date.now();
    reply({ ok: true });
    emitState(room);
  });

  socket.on("rematch", (reply = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.data.playerId);
    if (!room || !player) return reply({ ok: false });
    room.game.rematchVotes.add(player.id);
    if (room.game.rematchVotes.size === 2) {
      room.game = createGame();
      room.game.turnStartedAt = connectedPlayers(room).length === 2 ? Date.now() : null;
    }
    reply({ ok: true });
    emitState(room);
  });

  socket.on("leave_room", () => socket.disconnect(true));

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.data.playerId);
    if (!room || !player) return;
    updateClock(room);
    player.connected = false;
    player.socketId = null;
    room.game.turnStartedAt = null;
    emitState(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (connectedPlayers(room).length === 2 && !room.game.winner) {
      updateClock(room, now);
      emitState(room);
    }
    const allOffline = room.players.every((player) => !player.connected);
    if (allOffline && now - room.createdAt > 2 * 60 * 60 * 1000) rooms.delete(code);
  }
}, 1000).unref();

const port = Number(process.env.PORT) || 3000;
if (require.main === module) {
  server.listen(port, () => console.log(`Gomoku is running on http://localhost:${port}`));
}

module.exports = { app, server, rooms };
