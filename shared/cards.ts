import type { Card, Pattern, PatternType, Suit } from "./types.js";
export const SUITS: Record<Suit, string> = {
  spade: "♠",
  heart: "♥",
  club: "♣",
  diamond: "♦",
  joker: "★",
};
export function rankLabel(rank: number): string {
  return (
    (
      {
        11: "J",
        12: "Q",
        13: "K",
        14: "A",
        15: "2",
        16: "小王",
        17: "大王",
      } as Record<number, string>
    )[rank] || String(rank)
  );
}
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of ["spade", "heart", "club", "diamond"] as Suit[])
    for (let rank = 3; rank <= 15; rank++)
      cards.push({ id: `${suit}-${rank}`, rank, suit });
  cards.push(
    { id: "joker-16", rank: 16, suit: "joker" },
    { id: "joker-17", rank: 17, suit: "joker" },
  );
  return cards;
}
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}
const LABELS: Record<PatternType, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  "triple-single": "三带一",
  "triple-pair": "三带二",
  straight: "顺子",
  "pair-straight": "连对",
  airplane: "飞机",
  "airplane-single": "飞机带单",
  "airplane-pair": "飞机带对",
  "four-single": "四带二",
  "four-pair": "四带两对",
  bomb: "炸弹",
  rocket: "王炸",
};
function pattern(
  type: PatternType,
  rank: number,
  size: number,
  chain = 1,
): Pattern {
  return { type, rank, size, chain, label: LABELS[type] };
}
function consecutive(ranks: number[]): boolean {
  return (
    ranks.length > 0 &&
    ranks[ranks.length - 1] <= 14 &&
    ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)
  );
}
/** Returns all valid interpretations, important for ambiguous airplanes. Body cannot contain 2/jokers. */
export function identifyPatterns(cards: Card[]): Pattern[] {
  const n = cards.length;
  if (!n || n > 20 || new Set(cards.map((c) => c.id)).size !== n) return [];
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const groups = (count: number) =>
    ranks.filter((r) => counts.get(r) === count);
  const out: Pattern[] = [];
  if (n === 1) return [pattern("single", ranks[0], n)];
  if (n === 2 && ranks[0] === 16 && ranks[1] === 17)
    return [pattern("rocket", 17, n)];
  if (ranks.length === 1) {
    if (n === 2) out.push(pattern("pair", ranks[0], n));
    if (n === 3) out.push(pattern("triple", ranks[0], n));
    if (n === 4) out.push(pattern("bomb", ranks[0], n));
  }
  if (n === 4 && groups(3).length === 1)
    out.push(pattern("triple-single", groups(3)[0], n));
  if (n === 5 && groups(3).length === 1 && groups(2).length === 1)
    out.push(pattern("triple-pair", groups(3)[0], n));
  if (n >= 5 && ranks.length === n && consecutive(ranks))
    out.push(pattern("straight", ranks.at(-1)!, n, n));
  if (
    n >= 6 &&
    n % 2 === 0 &&
    ranks.every((r) => counts.get(r) === 2) &&
    consecutive(ranks)
  )
    out.push(pattern("pair-straight", ranks.at(-1)!, n, n / 2));
  if (n === 6 && groups(4).length === 1)
    out.push(pattern("four-single", groups(4)[0], n));
  if (n === 8 && groups(4).length === 1 && groups(2).length === 2)
    out.push(pattern("four-pair", groups(4)[0], n));
  for (const [unit, type] of [
    [3, "airplane"],
    [4, "airplane-single"],
    [5, "airplane-pair"],
  ] as const) {
    const chain = n / unit;
    if (!Number.isInteger(chain) || chain < 2) continue;
    for (let start = 3; start + chain - 1 <= 14; start++) {
      const body = Array.from({ length: chain }, (_, i) => start + i);
      // Wings cannot have the same rank as a body triple.
      if (!body.every((r) => counts.get(r) === 3)) continue;
      const wings = ranks.filter((r) => !body.includes(r));
      if (unit === 3 && wings.length !== 0) continue;
      if (
        unit === 4 &&
        wings.reduce((sum, r) => sum + counts.get(r)!, 0) !== chain
      )
        continue;
      if (
        unit === 5 &&
        (wings.length !== chain || !wings.every((r) => counts.get(r) === 2))
      )
        continue;
      out.push(pattern(type, start + chain - 1, n, chain));
    }
  }
  return out;
}
export function beats(next: Pattern, previous: Pattern): boolean {
  if (previous.type === "rocket") return false;
  if (next.type === "rocket") return true;
  if (next.type === "bomb" && previous.type !== "bomb") return true;
  return (
    next.type === previous.type &&
    next.size === previous.size &&
    next.chain === previous.chain &&
    next.rank > previous.rank
  );
}
export function choosePattern(
  cards: Card[],
  previous?: Pattern | null,
): Pattern | null {
  const patterns = identifyPatterns(cards);
  return patterns.find((p) => !previous || beats(p, previous)) || null;
}
/** A deliberately basic hint: find the weakest legal response; preserves big cards where possible. */
export function suggestPlay(hand: Card[], previous?: Pattern | null): Card[] {
  const sorted = [...hand].sort((a, b) => a.rank - b.rank);
  if (!previous) return sorted.slice(0, 1);
  const groups = new Map<number, Card[]>();
  sorted.forEach((c) => groups.set(c.rank, [...(groups.get(c.rank) || []), c]));
  // Enumerate rank counts, not every permutation of same-rank suits.
  const entries = [...groups.values()];
  const sizes = [...new Set([previous.size, 4, 2])].filter(
    (n) => n <= hand.length,
  );
  const legal: { cards: Card[]; pattern: Pattern }[] = [];
  for (const size of sizes) {
    const visit = (i: number, selected: Card[]) => {
      if (selected.length === size) {
        const p = choosePattern(selected, previous);
        if (p) legal.push({ cards: selected, pattern: p });
        return;
      }
      if (i === entries.length) return;
      const remaining = entries.slice(i).reduce((s, g) => s + g.length, 0);
      if (selected.length + remaining < size) return;
      for (
        let count = 0;
        count <= Math.min(entries[i].length, size - selected.length);
        count++
      )
        visit(i + 1, [...selected, ...entries[i].slice(0, count)]);
    };
    visit(0, []);
  }
  const priority = (p: Pattern) =>
    p.type === "rocket" ? 2 : p.type === "bomb" ? 1 : 0;
  legal.sort(
    (a, b) =>
      priority(a.pattern) - priority(b.pattern) ||
      a.pattern.rank - b.pattern.rank,
  );
  return legal[0]?.cards || [];
}
