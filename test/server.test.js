const test = require("node:test");
const assert = require("node:assert/strict");
const { io: createClient } = require("socket.io-client");
const { server, rooms } = require("../server");

function emitWithReply(client, event, payload) {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

function nextState(client, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off("state", handler);
      reject(new Error("Timed out waiting for game state"));
    }, 2000);
    function handler(state) {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      client.off("state", handler);
      resolve(state);
    }
    client.on("state", handler);
  });
}

test("two clients can join a room and receive an authoritative move", async (t) => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  const first = createClient(url, { transports: ["websocket"] });
  const second = createClient(url, { transports: ["websocket"] });

  t.after(() => {
    first.close();
    second.close();
    rooms.clear();
    server.close();
  });

  await Promise.all([
    new Promise((resolve) => first.once("connect", resolve)),
    new Promise((resolve) => second.once("connect", resolve))
  ]);

  const created = await emitWithReply(first, "create_room", { playerId: "one", name: "Alice" });
  assert.equal(created.ok, true);
  const firstReadyState = nextState(first, (state) => state.ready);
  const secondReadyState = nextState(second, (state) => state.ready);
  const joined = await emitWithReply(second, "join_room", {
    playerId: "two",
    name: "Bob",
    code: created.code
  });
  assert.equal(joined.ok, true);
  const [stateOne, stateTwo] = await Promise.all([firstReadyState, secondReadyState]);
  assert.equal(stateOne.myColor, 1);
  assert.equal(stateTwo.myColor, 2);

  const movedState = nextState(second, (state) => state.board[7][7] === 1);
  const moved = await emitWithReply(first, "move", { row: 7, col: 7 });
  assert.equal(moved.ok, true);
  assert.equal((await movedState).turn, 2);

  const illegal = await emitWithReply(first, "move", { row: 7, col: 8 });
  assert.equal(illegal.ok, false);
});
