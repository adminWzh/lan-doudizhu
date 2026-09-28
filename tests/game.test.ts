import test from "node:test";
import assert from "node:assert/strict";
import { Room } from "../server/game.js";
import { createDeck, suggestPlay } from "../shared/cards.js";
function setup() {
  const room = new Room("123456");
  ["林", "周", "你"].forEach((name) => room.add(name));
  room.players.forEach((p) => room.ready(p.id, true));
  return room;
}
function start() {
  const room = setup();
  room.bid(room.turnId!, true);
  room.bid(room.turnId!, false);
  room.bid(room.turnId!, false);
  return room;
}
test("three ready players automatically receive 17+17+17+3 unique cards; privacy", () => {
  const room = setup();
  assert.equal(room.phase, "bidding");
  const all = [...room.players.flatMap((p) => p.hand), ...room.bottom];
  assert.equal(all.length, 54);
  assert.equal(new Set(all.map((c) => c.id)).size, 54);
  for (const p of room.players) {
    const view = room.view(p.id);
    assert.equal(view.hand.length, 17);
    assert.equal(view.bottomCards.length, 0);
    assert.ok(view.players.every((p) => !("hand" in p)));
  }
  assert.throws(() => room.add("fourth"), /最多 3/);
});
test("not ready or offline players cannot trigger deal", () => {
  const room = new Room("123456");
  const a = room.add("a");
  const b = room.add("b");
  room.ready(a.id, true);
  room.ready(b.id, true);
  assert.equal(room.phase, "waiting");
  const c = room.add("c");
  room.connected(a.id, false);
  room.ready(c.id, true);
  assert.equal(room.phase, "waiting");
  room.connected(a.id, true);
  room.ready(a.id, true);
  assert.equal(room.phase, "bidding");
});
test("all decline triggers fresh deal; last affirmative bidder becomes landlord", () => {
  const room = setup();
  for (let i = 0; i < 3; i++) room.bid(room.turnId!, false);
  assert.equal(room.round, 2);
  assert.equal(room.bidHistory.length, 0);
  room.bid(room.turnId!, true);
  room.bid(room.turnId!, true);
  const last = room.turnId!;
  room.bid(last, true);
  assert.equal(room.landlordId, last);
  assert.equal(room.turnId, last);
  assert.equal(room.player(last).hand.length, 20);
  assert.equal(room.view(last).bottomCards.length, 3);
});
test("invalid actions never mutate state; two passes reset trick; disconnect pauses", () => {
  const room = start();
  const first = room.turnId!;
  const hand = room.player(first).hand;
  const snapshot = JSON.stringify(room.view(first));
  assert.throws(() => room.pass(first), /必须出牌/);
  assert.throws(
    () =>
      room.play(room.next(first), [room.player(room.next(first)).hand[0].id]),
    /没有轮到/,
  );
  assert.throws(() => room.play(first, ["made-up-card"]), /不属于/);
  assert.throws(() => room.play(first, [hand[0].id, hand[0].id]), /重复/);
  assert.equal(JSON.stringify(room.view(first)), snapshot);
  room.play(first, [hand.at(-1)!.id]);
  room.pass(room.turnId!);
  room.pass(room.turnId!);
  assert.equal(room.lastPlay, null);
  assert.equal(room.turnId, first);
  room.connected(room.next(first), false);
  assert.throws(
    () => room.play(first, [room.player(first).hand[0].id]),
    /离线/,
  );
  room.connected(room.next(first), true);
  room.play(first, [room.player(first).hand[0].id]);
});
test("farmer victory awards the team; rematch clears state and requires fresh ready", () => {
  const room = start();
  const farmer = room.players.find((p) => p.id !== room.landlordId)!;
  room.turnId = farmer.id;
  farmer.hand = [createDeck()[0]];
  room.play(farmer.id, [farmer.hand[0].id]);
  assert.equal(room.result?.side, "farmers");
  assert.equal(room.phase, "finished");
  assert.equal(room.turnId, null);
  room.rematch(farmer.id);
  assert.equal(room.phase, "waiting");
  assert.ok(room.players.every((p) => !p.ready && !p.hand.length));
  assert.equal(room.landlordId, null);
});
test("leaving in progress cancels game safely and transfers host", () => {
  const room = start();
  const host = room.hostId;
  room.remove(host);
  assert.equal(room.phase, "waiting");
  assert.equal(room.players.length, 2);
  assert.notEqual(room.hostId, host);
  assert.ok(room.players.every((p) => !p.ready && !p.hand.length));
});
test("25 random complete games: every hinted play is valid; conservation and winners", () => {
  for (let game = 0; game < 25; game++) {
    const room = start();
    let turns = 0;
    const played = new Set<string>();
    while (room.phase === "playing" && turns++ < 500) {
      const id = room.turnId!;
      const hint = suggestPlay(room.player(id).hand, room.lastPlay?.pattern);
      if (hint.length) {
        hint.forEach((c) => {
          assert.ok(!played.has(c.id));
          played.add(c.id);
        });
        room.play(
          id,
          hint.map((c) => c.id),
        );
      } else room.pass(id);
      assert.equal(
        played.size + room.players.reduce((s, p) => s + p.hand.length, 0),
        54,
      );
    }
    assert.equal(room.phase, "finished");
    assert.equal(room.player(room.result!.winnerId).hand.length, 0);
  }
});
