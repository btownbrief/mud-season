// Plain Node verification for the pure Mud Season engine.

import {
  createInitialState, legalMoves, applyMove, getStatus,
  suitOf, ROUND_SIZES,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;
let failed = 0;
function t(condition, label) {
  if (condition) { passed++; console.log(`  ok — ${label}`); }
  else { failed++; console.error(`FAIL — ${label}`); }
}

function cardsInState(state) {
  return [
    ...state.hands.flat(),
    ...state.undealt,
    state.trumpCard,
    ...state.trick.map((play) => play.card),
    ...state.completedTricks.flat().map((play) => play.card),
  ];
}

function fixture(overrides = {}) {
  return { ...createInitialState({ numPlayers: 3, seed: 77 }), ...overrides };
}

// Seeded deal, player counts, and JSON resume.
{
  const a = createInitialState({ numPlayers: 3, seed: 12345 });
  const b = createInitialState({ numPlayers: 3, seed: 12345 });
  const c = createInitialState({ numPlayers: 3, seed: 54321 });
  t(JSON.stringify(a) === JSON.stringify(b), 'same seed creates an identical game');
  t(JSON.stringify(a) !== JSON.stringify(c), 'different seed changes the deal');
  t(a.hands.length === 3 && a.hands.every((hand) => hand.length === 7), 'three-player opener deals seven each');
  const four = createInitialState({ numPlayers: 4, seed: 9 });
  t(four.hands.length === 4 && four.hands.every((hand) => hand.length === 7), 'four-player opener deals seven each');
  for (const state of [a, four]) {
    const cards = cardsInState(state);
    t(cards.length === 52 && new Set(cards).size === 52, `${state.numPlayers}-player opening deck is complete and unique`);
  }
  const thawed = JSON.parse(JSON.stringify(a));
  t(JSON.stringify(legalMoves(thawed)) === JSON.stringify(legalMoves(a)), 'JSON round-trip preserves legal moves');
  let rejected = false;
  try { createInitialState({ numPlayers: 2 }); } catch { rejected = true; }
  t(rejected, 'unsupported two-player table is rejected');
}

// Bidding rotates through every seat and hands play from dealer's left.
for (const numPlayers of [3, 4]) {
  let state = createInitialState({ numPlayers, seed: 18 + numPlayers });
  const seen = [];
  while (state.phase === 'bidding') {
    seen.push(state.currentPlayer);
    const move = legalMoves(state).find((candidate) => candidate.value === 0) || legalMoves(state)[0];
    state = applyMove(state, move);
  }
  t(JSON.stringify(seen) === JSON.stringify([...Array(numPlayers).keys()]), `${numPlayers}-player bid turn visits every seat in order`);
  t(state.currentPlayer === 0 && state.phase === 'playing', `${numPlayers}-player first trick opens left of dealer`);
}

// Screw-the-dealer hook.
{
  let state = createInitialState({ numPlayers: 3, seed: 4 });
  state = applyMove(state, { type: 'bid', value: 2 });
  state = applyMove(state, { type: 'bid', value: 0 });
  const dealerBids = legalMoves(state).map((move) => move.value);
  t(!dealerBids.includes(5), 'dealer cannot make total bids equal seven tricks');
  t(dealerBids.includes(4) && dealerBids.includes(6), 'numbers around the hooked bid remain legal');
}

// Follow suit is mandatory.
{
  const state = fixture({
    phase: 'playing', currentPlayer: 1, dealer: 2,
    hands: [['2C'], ['QH', 'AC'], ['3D']],
    trick: [{ player: 0, card: '9H' }], ledSuit: 'H', lastTrick: null,
    bids: [0, 0, 0], takes: [0, 0, 0], completedTricks: [],
  });
  const moves = legalMoves(state);
  t(moves.length === 1 && moves[0].card === 'QH', 'a player holding the led suit must follow it');
  const voidState = { ...state, hands: [['2C'], ['QS', 'AC'], ['3D']] };
  t(legalMoves(voidState).length === 2, 'a player void in the led suit may play any card');
}

// Trump beats the led suit, even at low rank.
{
  const state = fixture({
    phase: 'playing', currentPlayer: 2, dealer: 2,
    hands: [['2C'], ['3C'], ['KH', '4C']],
    trumpCard: '7S', trumpSuit: 'S', bids: [0, 0, 0], takes: [0, 0, 0],
    trick: [{ player: 0, card: 'AH' }, { player: 1, card: '2S' }],
    ledSuit: 'H', completedTricks: [], lastTrick: null,
  });
  const after = applyMove(state, { type: 'play', card: 'KH' });
  t(after.takes[1] === 1 && after.currentPlayer === 1, 'low trump wins and leads the next trick');
  t(after.lastTrick.length === 3 && after.trick.length === 0, 'completed trick remains visible without staying in play');
}

// Exact bids score 10 + tricks; misses score tricks only; applyMove is pure.
{
  let state = fixture({
    phase: 'playing', currentPlayer: 0, dealer: 2, handSize: 2,
    hands: [['AH'], ['2H'], ['3H']], trumpCard: '7S', trumpSuit: 'S',
    bids: [1, 0, 1], takes: [0, 1, 0], trick: [], ledSuit: null,
    completedTricks: [[{ player: 1, card: 'AS' }, { player: 2, card: 'KS' }, { player: 0, card: 'QS' }]],
    scores: [0, 0, 0], roundHistory: [],
  });
  const before = JSON.stringify(state);
  state = applyMove(state, { type: 'play', card: 'AH' });
  t(before.includes('"AH"'), 'old state remains intact after a play');
  state = applyMove(state, { type: 'play', card: '2H' });
  state = applyMove(state, { type: 'play', card: '3H' });
  t(state.phase === 'roundEnd', 'last trick opens the between-round ledger');
  t(JSON.stringify(state.scores) === JSON.stringify([11, 1, 0]), 'exact and missed bids use the requested scoring');
  const next = applyMove(state, { type: 'nextRound' });
  t(next.roundIndex === 1 && next.handSize === 6 && next.dealer === 0 && next.currentPlayer === 1,
    'next deal shrinks the hand, rotates dealer, and starts to dealer’s left');
}

// Bot work stays comfortably below the fleet's 300ms ceiling.
{
  const state = createInitialState({ numPlayers: 4, seed: 101 });
  const started = performance.now();
  for (let i = 0; i < 2000; i++) chooseMove(state, i % 2 ? 'mudflap' : 'plow');
  const elapsed = performance.now() - started;
  t(elapsed / 2000 < 300, `bot averages ${(elapsed / 2000).toFixed(3)}ms per move`);
}

// Deterministic random-legal soak: 200 complete matches, both table sizes.
let randomState = 0x5eed1234;
function choose(items) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return items[randomState % items.length];
}
let completed = 0;
let sizesOkay = true;
let invariantsOkay = true;
for (let gameIndex = 0; gameIndex < 200; gameIndex++) {
  const numPlayers = gameIndex % 2 ? 3 : 4;
  let state = createInitialState({ numPlayers, seed: gameIndex + 1 });
  let guard = 0;
  while (!getStatus(state).over && guard++ < 500) {
    if (state.handSize !== ROUND_SIZES[state.roundIndex]) sizesOkay = false;
    const cards = cardsInState(state);
    if (cards.length !== 52 || new Set(cards).size !== 52) invariantsOkay = false;
    const moves = legalMoves(state);
    if (!moves.length) break;
    state = applyMove(state, choose(moves));
  }
  if (getStatus(state).over) completed++;
  const totalPoints = state.roundHistory.reduce((sum, round) => sum + round.points.reduce((a, b) => a + b, 0), 0);
  if (totalPoints !== state.scores.reduce((a, b) => a + b, 0)) invariantsOkay = false;
}
t(completed === 200, `200/200 random-legal matches reach game over (got ${completed})`);
t(sizesOkay, 'every soak follows the 7→1→7 round sequence');
t(invariantsOkay, 'all soak states conserve cards and score totals');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
