import { game, config } from './server.js';
import { allCards, solve, buildDeck } from './cards.js';

let failures = 0;
const check = (label, ok) => {
  console.log(ok ? 'PASS' : 'FAIL', label);
  if (!ok) failures++;
};
const REJECT = 'INVALID_MOVE';
const random = { Shuffle: (a) => [...a].sort(() => Math.random() - 0.5) };

// ---- The card rules, checked by hand ----
check('an item in its own colour is the answer',
  JSON.stringify(solve([[2, 2], [0, 3]])) === JSON.stringify({ answer: 2, kind: 'own' }));
check('with none in its own colour, the object missing in shape and colour is the answer',
  JSON.stringify(solve([[0, 1], [2, 3]])) === JSON.stringify({ answer: 4, kind: 'missing' }));
check('two items in their own colour make a bad card', solve([[0, 0], [1, 1]]) === null);
check('two missing objects make a bad card', solve([[0, 1], [1, 0]]) === null);

// ---- Every possible card ----
const ALL = allCards();
check('there are plenty of cards', ALL.length >= 500);
check('every card has exactly one right answer',
  ALL.every((c) => { const r = solve(c.items); return r && r.answer === c.answer && r.kind === c.kind; }));
check('cards have 2 to 4 items, each shape and each colour at most once',
  ALL.every((c) => c.items.length >= 2 && c.items.length <= 4
    && new Set(c.items.map((i) => i[0])).size === c.items.length
    && new Set(c.items.map((i) => i[1])).size === c.items.length));
check('no two cards are alike',
  new Set(ALL.map((c) => JSON.stringify(c.items.map((i) => i.join()).sort()))).size === ALL.length);
const count = (a, k) => ALL.filter((c) => c.answer === a && c.kind === k).length;
check('every object is the answer to plenty of cards of each kind',
  [0, 1, 2, 3, 4].every((a) => count(a, 'own') >= 40 && count(a, 'missing') >= 40));

// ---- A deck ----
{
  const deck = buildDeck(30, random);
  check('a game has 30 cards', deck.length === 30);
  check('every object is the answer to 6 cards', [0, 1, 2, 3, 4].every((a) => deck.filter((c) => c.answer === a).length === 6));
  check('the cards in a game are all different',
    new Set(deck.map((c) => JSON.stringify(c.items.map((i) => i.join()).sort()))).size === 30);
  check('every card in the deck has the right answer attached',
    deck.every((c) => { const r = solve(c.items); return r && r.answer === c.answer; }));
}

// ---- The game ----
function newGame() {
  const ctx = { numPlayers: 16, currentPlayer: '0' };
  const G = game.setup({ ctx, random });
  const g = {
    G,
    play: (name, id, ...args) => game.moves[name].move({ G, ctx, playerID: id, random }, ...args),
    view: (id) => game.playerView({ G, ctx, playerID: id }),
    answer: () => G.deck[G.idx].answer,
  };
  g.tap = (id, obj, card = G.idx) => g.play('tap', id, (G.seqs[id] || 0) + 1, card, obj);
  return g;
}

// ---- Starting ----
{
  const g = newGame();
  check('the game waits in the ready phase', g.G.phase === 'ready' && g.view(null).card === null);
  check('tapping before the start is rejected', g.play('tap', '1', 1, 0, 0) === REJECT);
  check('a spectator cannot start', g.play('startGame', null, 0) === REJECT);
  check('the wrong game number is rejected', g.play('startGame', '1', 7) === REJECT);
  g.play('startGame', '1', 0);
  check('any player can start the game', g.G.phase === 'playing' && g.view(null).total === 30 && g.view(null).cardNo === 0);
  check('a second press for the same start is ignored', g.play('startGame', '2', 0) === REJECT);
  check('starting while playing is rejected', g.play('startGame', '2', 1) === REJECT);
}

// ---- Privacy ----
{
  const g = newGame();
  g.play('startGame', '1', 0);
  const v = g.view(null);
  const text = JSON.stringify(v);
  check('everyone sees the current card', Array.isArray(v.card) && v.card.length >= 2);
  check('nobody receives the answer or the deck', !('deck' in v) && !text.includes('answer') && !text.includes('kind'));
  check('nobody receives the cards to come', text.length < 500);
  check('every player gets the same view', JSON.stringify(g.view('3')).replace(/"cool":0,"mySeq":0/, '') === text.replace(/"cool":0,"mySeq":0/, ''));
}

// ---- Tapping ----
{
  const g = newGame();
  g.play('startGame', '1', 0);
  check('a spectator cannot tap', g.play('tap', null, 1, 0, 0) === REJECT);
  check('a wrong sequence number is rejected', g.play('tap', '1', 9, 0, 0) === REJECT);
  const first = g.G.deck[0];
  const wrong = (first.answer + 1) % 5;
  g.tap('2', wrong);
  check('a wrong tap freezes that player only', g.view('2').cool > 0 && g.view('3').cool === 0);
  check('the card does not change after a wrong tap', g.G.idx === 0 && Object.keys(g.G.scores).length === 0);
  g.tap('2', first.answer);
  check('taps while frozen are ignored, but counted', g.G.idx === 0 && g.G.seqs['2'] === 2);
  g.tap('3', first.answer);
  check('the right object wins the card and a point', g.G.scores['3'] === 1 && g.G.idx === 1);
  check('who won and why is recorded',
    g.G.last.by === '3' && g.G.last.obj === first.answer && g.G.last.kind === first.kind);
  check('everyone sees who won it', g.view('5').last.by === '3' && g.view(null).scores['3'] === 1);
  check('a repeated move is rejected', g.play('tap', '3', 1, 1, 0) === REJECT);
  g.tap('4', g.answer(), 0); // a late tap for card 0
  check('a late tap for the old card costs nothing', g.G.idx === 1 && !g.G.misses['4'] && g.view('4').cool === 0);
  g.tap('4', 9);
  check('a tap for a made-up object is ignored', g.G.idx === 1 && !g.G.misses['4']);
}

// ---- The freeze grows ----
{
  const g = newGame();
  g.play('startGame', '1', 0);
  const wrong = (g.answer() + 1) % 5;
  g.tap('1', wrong);
  const first = g.G.misses['1'].until - Date.now();
  g.G.misses['1'].until = 0;
  g.tap('1', wrong);
  const second = g.G.misses['1'].until - Date.now();
  check('a first wrong tap freezes for about 2 seconds', first > 1900 && first <= config.missBaseMs);
  check('a second wrong tap in a row freezes for about 3 seconds', second > 2900 && second <= 3000);
  for (let i = 0; i < 6; i++) {
    g.G.misses['1'].until = 0;
    g.tap('1', wrong);
  }
  check('the freeze never exceeds 5 seconds', g.G.misses['1'].until - Date.now() <= config.missMaxMs);
  g.G.misses['1'].until = 0;
  g.tap('1', g.answer());
  check('a right tap clears the streak', g.G.misses['1'].streak === 0);
}

// ---- A whole game ----
{
  const g = newGame();
  g.play('startGame', '1', 0);
  for (let i = 0; i < 30; i++) g.tap(i % 2 ? '2' : '1', g.answer());
  check('the game ends after the last card', g.G.phase === 'done' && g.G.idx === 30);
  check('equal scores are a tie', g.view(null).winners.join(',') === '1,2');
  check('no card is shown once the game is over', g.view(null).card === null);
  check('tapping after the end is rejected', g.play('tap', '1', 99, 30, 0) === REJECT);
  g.play('startGame', '2', g.G.gameNo);
  check('anyone can play again, with fresh scores',
    g.G.phase === 'playing' && g.G.idx === 0 && Object.keys(g.G.scores).length === 0 && g.G.gameNo === 2);
}
{
  const g = newGame();
  g.play('startGame', '1', 0);
  for (let i = 0; i < 30; i++) g.tap('3', g.answer());
  check('the player with the most cards wins', g.view(null).winners.join(',') === '3' && g.view(null).scores['3'] === 30);
}

// ---- Joining mid-game ----
{
  const g = newGame();
  g.play('startGame', '1', 0);
  g.tap('0', g.answer());
  g.tap('11', g.answer());
  check('a player who joins mid-game can score straight away', g.G.scores['11'] === 1 && g.G.idx === 2);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);