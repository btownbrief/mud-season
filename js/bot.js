/* MUD SEASON bots. They inspect state but choose exclusively from the
 * engine's public legalMoves list; no move bypasses the referee. */

import { legalMoves, rankOf, suitOf, RANKS } from './engine.js';

export const BOTS = {
  mudflap: {
    name: 'Mudflap',
    blurb: 'Bids big. Regrets nothing.',
  },
  plow: {
    name: 'Town Plow',
    blurb: 'Cautious, steady, usually home by dark.',
  },
};

function strength(state) {
  const hand = state.hands[state.currentPlayer];
  let estimate = 0;
  for (const card of hand) {
    const rank = RANKS.indexOf(rankOf(card));
    if (suitOf(card) === state.trumpSuit) estimate += rank >= 10 ? 0.9 : rank >= 7 ? 0.55 : 0.25;
    else if (rank === 12) estimate += 0.65;
    else if (rank === 11) estimate += 0.35;
  }
  return estimate;
}

function bidMove(state, style, moves) {
  const raw = strength(state);
  const target = style === 'mudflap'
    ? Math.min(state.handSize, Math.round(raw + 0.85))
    : Math.max(0, Math.floor(raw));
  return moves.reduce((best, move) => (
    Math.abs(move.value - target) < Math.abs(best.value - target) ? move : best
  ), moves[0]);
}

function playMove(state, style, moves) {
  const cards = moves.filter((move) => move.type === 'play');
  if (!cards.length) return moves[0];
  const bid = state.bids[state.currentPlayer];
  const taken = state.takes[state.currentPlayer];
  const wantsTrick = taken < bid;
  const score = (move) => {
    const rank = RANKS.indexOf(rankOf(move.card));
    const trump = suitOf(move.card) === state.trumpSuit ? 20 : 0;
    return rank + trump;
  };
  const ordered = cards.slice().sort((a, b) => score(a) - score(b));
  if (style === 'mudflap' && wantsTrick) return ordered[ordered.length - 1];
  if (wantsTrick) return ordered[Math.max(0, ordered.length - 2)];
  return ordered[0];
}

export function chooseMove(state, style = 'plow') {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves[0].type === 'bid') return bidMove(state, style, moves);
  if (moves[0].type === 'play') return playMove(state, style, moves);
  return moves[0];
}
