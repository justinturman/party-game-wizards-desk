// The rules of the cards. Pure functions: no server, no browser, no randomness.
//
// Objects are numbered 0 to 4: White Owl, Red Candle, Green Frog, Blue Crystal, Grey Key.
// Object number n has colour number n. A card item is [shape, colour], so [2, 2] is the
// Green Frog in green, and [2, 0] is the frog drawn in white.
export const OBJECT_COUNT = 5;

// Returns the object to grab, or null if the card has no single right answer:
//   rule 1: exactly one item is in its own colour, so grab that object
//   rule 2: no item is, and exactly one object has neither its shape nor its colour on the card
export function solve(items) {
  const own = items.filter(([shape, colour]) => shape === colour);
  if (own.length === 1) return { answer: own[0][0], kind: 'own' };
  if (own.length > 1) return null;
  const used = new Set();
  for (const [shape, colour] of items) {
    used.add(shape);
    used.add(colour);
  }
  const free = [0, 1, 2, 3, 4].filter((n) => !used.has(n));
  return free.length === 1 ? { answer: free[0], kind: 'missing' } : null;
}

function combinations(n, k, start = 0, prefix = []) {
  if (prefix.length === k) return [prefix];
  const out = [];
  for (let i = start; i < n; i++) out.push(...combinations(n, k, i + 1, [...prefix, i]));
  return out;
}

function arrangements(pool, k, prefix = []) {
  if (prefix.length === k) return [prefix];
  const out = [];
  for (const v of pool) if (!prefix.includes(v)) out.push(...arrangements(pool, k, [...prefix, v]));
  return out;
}

// Every valid card: 2 to 4 items, each shape and each colour used at most once,
// and exactly one right answer
export function allCards() {
  const cards = [];
  for (let k = 2; k <= 4; k++) {
    for (const shapes of combinations(OBJECT_COUNT, k)) {
      for (const colours of arrangements([0, 1, 2, 3, 4], k)) {
        const items = shapes.map((shape, i) => [shape, colours[i]]);
        const result = solve(items);
        if (result) cards.push({ items, answer: result.answer, kind: result.kind });
      }
    }
  }
  return cards;
}

const ALL = allCards();
const BY_ANSWER = [0, 1, 2, 3, 4].map((a) => ALL.filter((c) => c.answer === a));

// A deck where every object is the right answer equally often, in random order,
// with the items on each card in random places
export function buildDeck(count, random) {
  const each = Math.ceil(count / OBJECT_COUNT);
  let picks = [];
  for (let a = 0; a < OBJECT_COUNT; a++) picks.push(...random.Shuffle(BY_ANSWER[a]).slice(0, each));
  picks = random.Shuffle(picks).slice(0, count);
  return picks.map((c) => ({
    items: random.Shuffle(c.items).map(([shape, colour]) => [shape, colour]),
    answer: c.answer,
    kind: c.kind,
  }));
}