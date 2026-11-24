import { buildDeck, OBJECT_COUNT } from './cards.js';

const INVALID_MOVE = 'INVALID_MOVE';

// Settings. Exported so the tests can inspect them.
export const config = { cardsPerGame: 30, missBaseMs: 2000, missStepMs: 1000, missMaxMs: 5000 };

const isSeat = (id) => id !== null && id !== undefined && id !== '';

// Taps carry a sequence number, so a tap that is resent after a lost reply
// is only ever applied once, and always in order.
function takeSeq(G, id, seq) {
  if (seq !== (G.seqs[id] || 0) + 1) return false;
  G.seqs[id] = seq;
  return true;
}

export const game = {
  name: 'wizards-desk',
  // Players join at any time. All seats are created up front and fill as people arrive.
  minPlayers: 16,
  maxPlayers: 16,

  // Everyone taps at the same time, with no turns
  turn: { activePlayers: { all: null } },

  setup: () => ({
    phase: 'ready', // ready -> playing -> done -> (play again) -> playing ...
    gameNo: 0,
    deck: [], // never sent to any device
    idx: 0, // the card showing now
    scores: {}, // player id -> points
    misses: {}, // player id -> { until, streak }
    last: null, // who won the previous card, and which rule applied
    seqs: {},
  }),

  moves: {
    // Any player can start a game, or the next one. The game number stops a second press from restarting it.
    startGame: {
      client: false,
      move: ({ G, playerID, random }, gameNo) => {
        if (G.phase === 'playing' || !isSeat(playerID) || gameNo !== G.gameNo) return INVALID_MOVE;
        G.deck = buildDeck(config.cardsPerGame, random);
        G.idx = 0;
        G.scores = {};
        G.misses = {};
        G.last = null;
        G.gameNo += 1;
        G.phase = 'playing';
      },
    },

    // A tap on one of the five objects. The server checks it, so the answer never leaves the server.
    tap: {
      client: false,
      move: ({ G, playerID }, seq, cardNo, obj) => {
        if (G.phase !== 'playing' || !isSeat(playerID)) return INVALID_MOVE;
        if (!takeSeq(G, playerID, seq)) return INVALID_MOVE;
        if (!Number.isInteger(obj) || obj < 0 || obj >= OBJECT_COUNT) return;
        if (cardNo !== G.idx) return; // a late tap: somebody already took that card, and it costs nothing

        const now = Date.now();
        const m = G.misses[playerID] || { until: 0, streak: 0 };
        if (now < m.until) return; // still frozen after a wrong tap

        const card = G.deck[G.idx];
        if (obj === card.answer) {
          G.scores[playerID] = (G.scores[playerID] || 0) + 1;
          G.misses[playerID] = { until: 0, streak: 0 };
          G.last = { n: G.idx, by: playerID, obj, kind: card.kind };
          G.idx += 1;
          if (G.idx >= G.deck.length) G.phase = 'done';
        } else {
          const streak = m.streak + 1;
          const pause = Math.min(config.missMaxMs, config.missBaseMs + (streak - 1) * config.missStepMs);
          G.misses[playerID] = { until: now + pause, streak };
        }
      },
    },
  },

  // THE PRIVACY RULES:
  //  - the answer is never sent, only the card everyone is looking at
  //  - the deck (the cards to come) is never sent
  //  - a player's freeze time is sent only to that player
  playerView: ({ G, playerID }) => {
    const isPlayer = isSeat(playerID);
    const playing = G.phase === 'playing';
    const m = isPlayer ? G.misses[playerID] : null;
    const best = Math.max(0, ...Object.values(G.scores));
    return {
      phase: G.phase,
      gameNo: G.gameNo,
      total: G.deck.length,
      cardNo: G.idx,
      card: playing ? G.deck[G.idx].items : null,
      last: G.last,
      scores: G.scores,
      winners:
        G.phase === 'done' && best > 0 ? Object.keys(G.scores).filter((id) => G.scores[id] === best) : [],
      cool: m ? Math.max(0, m.until - Date.now()) : 0,
      mySeq: isPlayer ? G.seqs[playerID] || 0 : 0,
    };
  },
  // No endIf: the room keeps going, one game after another
};