import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { createGameServer } from "../server/app.js";
import type { RoomView, ServerMessage, Session } from "../shared/types.js";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, message = "condition") {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail(`Timed out: ${message}`);
}
async function client(url: string) {
  const ws = new WebSocket(url);
  let room: RoomView | undefined;
  let session: Session | undefined;
  let seq = 0;
  const pending = new Map<
    string,
    (message: Extract<ServerMessage, { type: "ack" }>) => void
  >();
  ws.on("message", (raw) => {
    const message: ServerMessage = JSON.parse(raw.toString());
    if (message.type === "state") room = message.room;
    if (message.type === "ack") {
      if (message.session) session = message.session;
      pending.get(message.requestId)?.(message);
      pending.delete(message.requestId);
    }
  });
  await once(ws, "open");
  return {
    ws,
    get room() {
      return room;
    },
    get session() {
      return session;
    },
    async send(data: Record<string, unknown>) {
      const requestId = String(++seq);
      return new Promise<Extract<ServerMessage, { type: "ack" }>>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("ack timeout"));
          }, 3000);
          pending.set(requestId, (msg) => {
            clearTimeout(timer);
            resolve(msg);
          });
          ws.send(JSON.stringify({ ...data, requestId }));
        },
      );
    },
  };
}
test("real WS: room, full capacity, privacy, invalid actions, reconnect, complete game, rematch", async () => {
  const app = createGameServer();
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const port = (app.server.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}/ws`;
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    for (let i = 0; i < 4; i++) clients.push(await client(url));
    const [a, b, c, d] = clients;
    assert.equal((await a.send({ type: "create", name: "房主" })).ok, true);
    const code = a.session!.roomCode;
    assert.equal(
      (await b.send({ type: "join", code, name: "农民甲" })).ok,
      true,
    );
    assert.equal(
      (await c.send({ type: "join", code, name: "农民乙" })).ok,
      true,
    );
    assert.equal(
      (await d.send({ type: "join", code, name: "第四位" })).ok,
      false,
    );
    for (const x of [a, b, c])
      assert.equal((await x.send({ type: "ready", ready: true })).ok, true);
    await until(() => [a, b, c].every((x) => x.room?.phase === "bidding"));
    assert.equal(
      new Set([a, b, c].flatMap((x) => x.room!.hand.map((c) => c.id))).size,
      51,
    );
    for (const x of [a, b, c]) {
      assert.equal(x.room!.bottomCards.length, 0);
      assert.ok(x.room!.players.every((p) => !("hand" in p)));
    }
    let playing = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const actor = playing.find(
        (x) => x.session!.playerId === a.room!.turnId,
      )!;
      const revision = a.room!.revision;
      assert.equal((await actor.send({ type: "bid", bid: i === 0 })).ok, true);
      await until(() => playing.every((x) => x.room!.revision > revision));
    }
    assert.equal(a.room!.phase, "playing");
    const first = playing.find((x) => x.session!.playerId === a.room!.turnId)!;
    assert.equal(first.room!.hand.length, 20);
    assert.equal(
      (await first.send({ type: "play", cardIds: ["stolen"] })).ok,
      false,
    );
    assert.equal((await first.send({ type: "pass" })).ok, false);
    const other = playing.find((x) => x !== first)!;
    assert.equal(
      (await other.send({ type: "play", cardIds: [other.room!.hand[0].id] }))
        .ok,
      false,
    );
    // Resume the same seat and exact private hand after a broken connection.
    const previousHand = b.room!.hand.map((c) => c.id);
    const token = b.session!.token;
    const id = b.session!.playerId;
    b.ws.close();
    await once(b.ws, "close");
    await until(() => a.room!.players.some((p) => p.id === id && !p.connected));
    const replacement = await client(url);
    clients.push(replacement);
    assert.equal((await replacement.send({ type: "resume", token })).ok, true);
    await until(
      () => !!replacement.room && a.room!.players.every((p) => p.connected),
    );
    assert.deepEqual(
      replacement.room!.hand.map((c) => c.id),
      previousHand,
    );
    playing = [a, replacement, c];
    // Everyone passes to the original leader, who eventually empties their real 20-card hand.
    let moves = 0;
    while (a.room!.phase === "playing" && moves++ < 100) {
      const actor = playing.find(
        (x) => x.session!.playerId === a.room!.turnId,
      )!;
      const revision = a.room!.revision;
      const action = !a.room!.lastPlay
        ? { type: "play", cardIds: [actor.room!.hand[0].id] }
        : { type: "pass" };
      assert.equal((await actor.send(action)).ok, true);
      await until(() => playing.every((x) => x.room!.revision > revision));
    }
    assert.equal(a.room!.phase, "finished");
    assert.equal(a.room!.result!.side, "landlord");
    assert.equal((await a.send({ type: "rematch" })).ok, true);
    await until(() => playing.every((x) => x.room!.phase === "waiting"));
    assert.equal((await replacement.send({ type: "leave" })).ok, true);
    assert.equal(
      (await d.send({ type: "join", code, name: "新朋友" })).ok,
      true,
    );
    assert.equal(
      (await fetch(`http://127.0.0.1:${port}/api/health`)).status,
      200,
    );
    const network = await (
      await fetch(`http://127.0.0.1:${port}/api/network`)
    ).json();
    assert.ok(Array.isArray(network.addresses));
  } finally {
    clients.forEach((c) => c.ws.terminate());
    await app.close();
  }
});
test("expired disconnected seat is removed; ongoing game returns to waiting", async () => {
  const app = createGameServer({ reconnectMs: 60 });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const url = `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`;
  const clients: Awaited<ReturnType<typeof client>>[] = [];
  try {
    for (let i = 0; i < 3; i++) clients.push(await client(url));
    await clients[0].send({ type: "create", name: "A" });
    const code = clients[0].session!.roomCode;
    for (const x of clients.slice(1))
      await x.send({ type: "join", name: "B", code });
    for (const x of clients) await x.send({ type: "ready", ready: true });
    await until(() => clients[0].room?.phase === "bidding");
    clients[2].ws.close();
    await until(() => clients[0].room?.players.length === 2);
    assert.equal(clients[0].room!.phase, "waiting");
    const newClient = await client(url);
    clients.push(newClient);
    assert.equal(
      (
        await newClient.send({
          type: "resume",
          token: clients[2].session!.token,
        })
      ).code,
      "SESSION_EXPIRED",
    );
  } finally {
    clients.forEach((c) => c.ws.terminate());
    await app.close();
  }
});
test("reject cross-origin upgrades", async () => {
  const app = createGameServer();
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const ws = new WebSocket(
    `ws://127.0.0.1:${(app.server.address() as AddressInfo).port}/ws`,
    { origin: "https://unrelated.invalid" },
  );
  try {
    const [error] = await once(ws, "error");
    assert.match(String(error), /403/);
  } finally {
    ws.terminate();
    await app.close();
  }
});
