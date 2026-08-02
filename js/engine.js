/* MUD SEASON — pure Oh Hell rules.
 *
 * No DOM, timers, Date, or Math.random. The seeded shuffle state travels
 * inside the JSON-serializable game state so every phone sees the same road.
 *
 * Moves:
 *   { type: 'bid', value: 0 }
 *   { type: 'play', card: 'AS' }
 *   { type: 'nextRound' }
 */

export const SUITS = ['S', 'H', 'D', 'C'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const ROUND_SIZES = [7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7];

export const suitOf = (card) => card[1];
export const rankOf = (card) => card[0];

function rngNext(s) {
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, s };
}

function shuffle(cards, rngState) {
  const deck = cards.slice();
  let s = rngState;
  for (let i = deck.length - 1; i > 0; i--) {
    const r = rngNext(s);
    s = r.s;
    const j = Math.floor(r.value * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return { deck, rng: s };
}

function freshDeck() {
  return SUITS.flatMap((suit) => RANKS.map((rank) => rank + suit));
}

function dealRound(base, roundIndex, dealer) {
  const handSize = ROUND_SIZES[roundIndex];
  const shuffled = shuffle(freshDeck(), base.rng);
  const hands = Array.from({ length: base.numPlayers }, () => []);
  let at = 0;
  for (let card = 0; card < handSize; card++) {
    for (let offset = 1; offset <= base.numPlayers; offset++) {
      const player = (dealer + offset) % base.numPlayers;
      hands[player].push(shuffled.deck[at++]);
    }
  }
  const trumpCard = shuffled.deck[at++];
  return {
    ...base,
    rng: shuffled.rng,
    phase: 'bidding',
    roundIndex,
    handSize,
    dealer,
    currentPlayer: (dealer + 1) % base.numPlayers,
    hands,
    undealt: shuffled.deck.slice(at),
    trumpCard,
    trumpSuit: suitOf(trumpCard),
    bids: Array(base.numPlayers).fill(null),
    takes: Array(base.numPlayers).fill(0),
    trick: [],
    ledSuit: null,
    completedTricks: [],
    lastTrick: null,
    lastAction: { type: 'deal', roundIndex, dealer, handSize },
  };
}

export function createInitialState(options = {}) {
  const numPlayers = options.numPlayers ?? 3;
  if (!Number.isInteger(numPlayers) || numPlayers < 3 || numPlayers > 4) {
    throw new Error('numPlayers must be 3 or 4');
  }
  const seed = (options.seed ?? 1) | 0;
  const base = {
    version: 1,
    seed,
    rng: seed,
    numPlayers,
    scores: Array(numPlayers).fill(0),
    roundHistory: [],
  };
  // The player to the dealer's left opens; seat 0 therefore opens game one.
  return dealRound(base, 0, numPlayers - 1);
}

function sameMove(a, b) {
  return a.type === b.type && a.value === b.value && a.card === b.card;
}

export function legalMoves(state) {
  if (state.phase === 'gameOver') return [];
  if (state.phase === 'roundEnd') return [{ type: 'nextRound' }];

  if (state.phase === 'bidding') {
    const moves = [];
    const isDealer = state.currentPlayer === state.dealer;
    const priorTotal = state.bids.reduce((sum, bid) => sum + (bid ?? 0), 0);
    for (let value = 0; value <= state.handSize; value++) {
      // Classic screw-the-dealer hook: the final bid may not make the total
      // equal the number of tricks available in this hand.
      if (isDealer && priorTotal + value === state.handSize) continue;
      moves.push({ type: 'bid', value });
    }
    return moves;
  }

  if (state.phase === 'playing') {
    const hand = state.hands[state.currentPlayer];
    if (!state.ledSuit) return hand.map((card) => ({ type: 'play', card }));
    const followers = hand.filter((card) => suitOf(card) === state.ledSuit);
    return (followers.length ? followers : hand).map((card) => ({ type: 'play', card }));
  }

  return [];
}

export function applyMove(state, move) {
  if (!legalMoves(state).some((candidate) => sameMove(candidate, move))) {
    throw new Error('Illegal move: ' + JSON.stringify(move));
  }
  if (move.type === 'bid') return applyBid(state, move.value);
  if (move.type === 'play') return applyPlay(state, move.card);
  return dealRound(state, state.roundIndex + 1, (state.dealer + 1) % state.numPlayers);
}

function applyBid(state, value) {
  const player = state.currentPlayer;
  const bids = state.bids.slice();
  bids[player] = value;
  const finished = bids.every((bid) => bid !== null);
  return {
    ...state,
    bids,
    phase: finished ? 'playing' : 'bidding',
    currentPlayer: finished ? (state.dealer + 1) % state.numPlayers : (player + 1) % state.numPlayers,
    lastAction: { type: 'bid', player, value },
  };
}

function trickWinner(trick, trumpSuit, ledSuit) {
  let best = trick[0];
  let bestClass = suitOf(best.card) === trumpSuit ? 2 : 1;
  let bestRank = RANKS.indexOf(rankOf(best.card));
  for (const play of trick.slice(1)) {
    const suit = suitOf(play.card);
    const cls = suit === trumpSuit ? 2 : (suit === ledSuit ? 1 : 0);
    const rank = RANKS.indexOf(rankOf(play.card));
    if (cls > bestClass || (cls === bestClass && rank > bestRank)) {
      best = play;
      bestClass = cls;
      bestRank = rank;
    }
  }
  return best.player;
}

function applyPlay(state, card) {
  const player = state.currentPlayer;
  const hand = state.hands[player];
  const hands = state.hands.map((cards, seat) => (
    seat === player ? cards.filter((held) => held !== card) : cards.slice()
  ));
  const ledSuit = state.ledSuit || suitOf(card);
  const trick = state.trick.concat([{ player, card }]);

  if (trick.length < state.numPlayers) {
    return {
      ...state,
      hands,
      trick,
      ledSuit,
      currentPlayer: (player + 1) % state.numPlayers,
      lastTrick: null,
      lastAction: { type: 'play', player, card, trickComplete: false },
    };
  }

  const winner = trickWinner(trick, state.trumpSuit, ledSuit);
  const takes = state.takes.slice();
  takes[winner]++;
  const completedTricks = state.completedTricks.concat([trick]);
  const roundFinished = hands.every((cards) => cards.length === 0);

  if (!roundFinished) {
    return {
      ...state,
      hands,
      takes,
      trick: [],
      ledSuit: null,
      completedTricks,
      lastTrick: trick,
      currentPlayer: winner,
      lastAction: { type: 'play', player, card, trickComplete: true, trickWinner: winner },
    };
  }

  const points = takes.map((taken, seat) => (taken === state.bids[seat] ? 10 + taken : taken));
  const scores = state.scores.map((score, seat) => score + points[seat]);
  const finalRound = state.roundIndex === ROUND_SIZES.length - 1;
  const summary = {
    roundIndex: state.roundIndex,
    handSize: state.handSize,
    dealer: state.dealer,
    bids: state.bids.slice(),
    takes: takes.slice(),
    points,
    scores: scores.slice(),
  };
  return {
    ...state,
    hands,
    takes,
    scores,
    trick: [],
    ledSuit: null,
    completedTricks,
    lastTrick: trick,
    roundHistory: state.roundHistory.concat([summary]),
    phase: finalRound ? 'gameOver' : 'roundEnd',
    currentPlayer: 0,
    lastAction: {
      type: 'play', player, card, trickComplete: true, trickWinner: winner,
      roundComplete: true,
    },
  };
}

export function getStatus(state) {
  if (state.phase !== 'gameOver') {
    return { status: 'active', phase: state.phase, over: false, winners: [], winner: null };
  }
  const high = Math.max(...state.scores);
  const winners = [];
  state.scores.forEach((score, player) => { if (score === high) winners.push(player); });
  return {
    status: 'over',
    phase: state.phase,
    over: true,
    winners,
    winner: winners.length === 1 ? winners[0] : null,
  };
}
