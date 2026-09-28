import test from "node:test";
import assert from "node:assert/strict";
import {
  beats,
  choosePattern,
  createDeck,
  identifyPatterns,
  suggestPlay,
} from "../shared/cards.js";
import type { PatternType } from "../shared/types.js";
function cards(ranks: number[]) {
  const deck = createDeck();
  return ranks.map((r) => {
    const i = deck.findIndex((c) => c.rank === r);
    assert.ok(i >= 0);
    return deck.splice(i, 1)[0];
  });
}
const cases: [PatternType, number[]][] = [
  ["single", [3]],
  ["pair", [5, 5]],
  ["triple", [7, 7, 7]],
  ["triple-single", [3, 3, 3, 4]],
  ["triple-pair", [5, 5, 5, 9, 9]],
  ["straight", [10, 11, 12, 13, 14]],
  ["pair-straight", [3, 3, 4, 4, 5, 5]],
  ["airplane", [3, 3, 3, 4, 4, 4]],
  ["airplane-single", [3, 3, 3, 4, 4, 4, 6, 6]],
  ["airplane-pair", [3, 3, 3, 4, 4, 4, 7, 7, 8, 8]],
  ["four-single", [3, 3, 3, 3, 8, 8]],
  ["four-pair", [3, 3, 3, 3, 8, 8, 9, 9]],
  ["bomb", [15, 15, 15, 15]],
  ["rocket", [16, 17]],
];
test("54 unique cards; 17 ranks include two different jokers", () => {
  const deck = createDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map((c) => c.id)).size, 54);
  assert.equal(deck.filter((c) => c.suit === "joker").length, 2);
});
for (const [type, ranks] of cases)
  test(`recognize ${type}`, () =>
    assert.ok(identifyPatterns(cards(ranks)).some((p) => p.type === type)));
test("reject invalid chains and wings", () => {
  for (const ranks of [
    [3, 4, 5, 6],
    [11, 12, 13, 14, 15],
    [3, 3, 4, 4],
    [3, 3, 3, 3, 4, 4, 4, 5],
    [14, 14, 14, 15, 15, 15],
    [3, 3, 3, 3, 8, 8, 8, 8],
  ])
    assert.equal(identifyPatterns(cards(ranks)).length, 0, ranks.join(","));
  const c = cards([3])[0];
  assert.equal(identifyPatterns([c, c]).length, 0);
});
test("same type/size only; bombs and rocket override ordinary patterns", () => {
  const p = (ranks: number[]) => choosePattern(cards(ranks))!;
  assert.ok(beats(p([5]), p([4])));
  assert.ok(!beats(p([4]), p([4])));
  assert.ok(!beats(p([5, 5]), p([4])));
  assert.ok(!beats(p([4, 5, 6, 7, 8, 9]), p([3, 4, 5, 6, 7])));
  assert.ok(beats(p([3, 3, 3, 3]), p([15, 15, 15, 14, 14])));
  assert.ok(beats(p([4, 4, 4, 4]), p([3, 3, 3, 3])));
  assert.ok(beats(p([16, 17]), p([15, 15, 15, 15])));
  assert.ok(!beats(p([15, 15, 15, 15]), p([16, 17])));
});
test("ambiguous airplane responds using a valid stronger interpretation", () => {
  const hand = cards([3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]);
  const previous = {
    type: "airplane-single" as const,
    rank: 5,
    size: 12,
    chain: 3,
    label: "飞机带单",
  };
  assert.equal(choosePattern(hand, previous)?.rank, 6);
});
test("hints return legal cards, choose weakest response and fall back to bomb", () => {
  const prev = choosePattern(cards([4, 4]))!;
  const hand = cards([3, 3, 3, 3, 5, 5, 6, 6, 16, 17]);
  const hint = suggestPlay(hand, prev);
  assert.deepEqual(
    hint.map((c) => c.rank),
    [5, 5],
  );
  assert.equal(
    choosePattern(suggestPlay(cards([3, 3, 3, 3]), prev), prev)?.type,
    "bomb",
  );
  assert.deepEqual(suggestPlay(cards([3, 4]), prev), []);
  assert.equal(suggestPlay(hand)[0].rank, 3);
});
