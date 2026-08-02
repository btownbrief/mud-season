// MUD SEASON — UI and online transport only. Every rule lives in engine.js.

import {
  createInitialState, legalMoves, applyMove, getStatus,
  suitOf, rankOf, RANKS, SUITS, ROUND_SIZES,
} from './engine.js';
import { chooseMove, BOTS } from './bot.js';
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';

const $ = (id) => document.getElementById(id);
const GAME = 'mud-season';
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);

let G = null; // { mode, state }
let online = null; // { match, myPlayer }
let handRevealed = true;
let selectedSeats = 3;
let panelIntent = 'host';
let botTimer = 0;
let leaveTimer = 0;
let onlineBusy = false;
let pollErrors = 0;

const menu = $('menu');
const handoff = $('handoff');
const game = $('game');
const scoreOverlay = $('scoreOverlay');
const onlinePanel = $('onlinePanel');
const lobby = $('lobby');
const opName = $('opName');
const opCode = $('opCode');
const opCodeWrap = $('opCodeWrap');
const opSeatsWrap = $('opSeatsWrap');
const opError = $('opError');
const rejoinBtn = $('rejoinBtn');

function newSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] | 0;
}

function showScreen(target) {
  [menu, handoff, game].forEach((screen) => screen.classList.toggle('hidden', screen !== target));
}

function offlineNames(numPlayers, mode) {
  if (mode === 'practice') {
    return ['You', BOTS.mudflap.name, BOTS.plow.name, 'Mudflap Jr.'].slice(0, numPlayers);
  }
  return Array.from({ length: numPlayers }, (_, index) => `Driver ${index + 1}`);
}

function playerName(player) {
  if (!G) return `Driver ${player + 1}`;
  if (G.mode === 'online' && online) {
    const seat = online.match.seats.find((entry) => entry.seat === player);
    return seat ? seat.name : `Driver ${player + 1}`;
  }
  return offlineNames(G.state.numPlayers, G.mode)[player];
}

function localSeat() {
  if (!G) return 0;
  if (G.mode === 'online') return online.myPlayer;
  if (G.mode === 'practice') return 0;
  return G.state.currentPlayer;
}

function canAct() {
  if (!G || onlineBusy || getStatus(G.state).over) return false;
  if (G.state.phase === 'roundEnd') {
    return G.mode !== 'online' || online.myPlayer === 0;
  }
  if (G.mode === 'online') {
    return online.match.status === 'playing' && G.state.currentPlayer === online.myPlayer;
  }
  if (G.mode === 'practice') return G.state.currentPlayer === 0;
  return handRevealed;
}

function startGame(mode, numPlayers) {
  clearTimeout(botTimer);
  G = { mode, state: createInitialState({ numPlayers, seed: newSeed() }) };
  online = null;
  onlineBusy = false;
  $('scoreNext').classList.remove('hidden');
  scoreOverlay.classList.add('hidden');
  if (mode === 'pass') showHandoff(G.state.currentPlayer);
  else {
    handRevealed = true;
    showScreen(game);
    render();
    scheduleBot();
  }
}

document.querySelectorAll('[data-start]').forEach((button) => {
  button.addEventListener('click', () => startGame(button.dataset.start, Number(button.dataset.players)));
});

function showHandoff(player) {
  handRevealed = false;
  $('handoffTitle').textContent = `Pass to ${playerName(player)}`;
  $('handoffText').textContent = G.state.phase === 'bidding'
    ? 'Their bid — and their hand — stay private until they are ready.'
    : 'The next hand is tucked away. Small town, long memory.';
  showScreen(handoff);
}

$('handoffBtn').addEventListener('click', () => {
  handRevealed = true;
  showScreen(game);
  render();
});

function render() {
  if (!G) return;
  if (['bidding', 'playing'].includes(G.state.phase)) scoreOverlay.classList.add('hidden');
  renderDrivers();
  renderTable();
  renderHand();
  renderActions();
  if (G.state.phase === 'roundEnd' || G.state.phase === 'gameOver') renderScore();
}

function renderDrivers() {
  const grid = $('driverGrid');
  grid.replaceChildren();
  const me = localSeat();
  for (let player = 0; player < G.state.numPlayers; player++) {
    const card = document.createElement('div');
    card.className = 'driver';
    if (player === G.state.currentPlayer && !['roundEnd', 'gameOver'].includes(G.state.phase)) card.classList.add('active');
    if (player === me) card.classList.add('me');
    const name = document.createElement('div');
    name.className = 'driver-name';
    name.textContent = playerName(player); // online names never enter markup
    const stats = document.createElement('div');
    stats.className = 'driver-stats';
    const count = document.createElement('span');
    count.textContent = `🂠 ${G.state.hands[player].length}`;
    const bid = document.createElement('span');
    bid.textContent = `BID ${G.state.bids[player] ?? '—'}`;
    const took = document.createElement('span');
    took.textContent = `GOT ${G.state.takes[player]}`;
    stats.append(count, bid, took);
    card.append(name, stats);
    grid.appendChild(card);
  }
}

function cardText(card) {
  return `${rankOf(card)}${SUIT_SYMBOL[suitOf(card)]}`;
}

function styleSuit(element, card) {
  element.classList.toggle('red-suit', RED_SUITS.has(suitOf(card)));
}

function renderTable() {
  const state = G.state;
  $('roundLabel').textContent = `ROAD ${state.roundIndex + 1} OF ${ROUND_SIZES.length} · ${state.handSize} CARD${state.handSize === 1 ? '' : 'S'}`;
  const trump = $('trumpCard');
  trump.textContent = cardText(state.trumpCard);
  styleSuit(trump, state.trumpCard);

  const trickEl = $('trick');
  trickEl.replaceChildren();
  const plays = state.trick.length ? state.trick : (state.lastTrick || []);
  const winning = !state.trick.length && state.lastAction?.trickComplete
    ? state.lastAction.trickWinner : null;
  plays.forEach((play) => {
    const wrap = document.createElement('div');
    wrap.className = 'trick-play';
    const card = document.createElement('div');
    card.className = 'trick-card';
    card.textContent = cardText(play.card);
    styleSuit(card, play.card);
    if (play.player === winning) card.classList.add('winner');
    const owner = document.createElement('div');
    owner.className = 'trick-owner';
    owner.textContent = playerName(play.player);
    wrap.append(card, owner);
    trickEl.appendChild(wrap);
  });

  let note = 'BID THE ROAD';
  if (state.phase === 'playing') {
    if (state.trick.length) note = `${SUIT_SYMBOL[state.ledSuit]} LED · FOLLOW SUIT`;
    else if (winning !== null) note = `${playerName(winning).toUpperCase()} TOOK THE TRICK`;
    else note = `${playerName(state.currentPlayer).toUpperCase()} LEADS`;
  } else if (state.phase === 'roundEnd' || state.phase === 'gameOver') {
    note = 'ROAD COMPLETE · CHECK THE LEDGER';
  }
  $('trickNote').textContent = note;
}

function visibleHandPlayer() {
  if (G.mode === 'online') return online.myPlayer;
  if (G.mode === 'practice') return 0;
  return handRevealed ? G.state.currentPlayer : null;
}

function renderHand() {
  const handEl = $('hand');
  handEl.replaceChildren();
  const player = visibleHandPlayer();
  if (player === null) return;
  $('handLabel').textContent = G.mode === 'pass'
    ? `${playerName(player).toUpperCase()}'S HAND`
    : 'YOUR HAND';
  const legalCards = new Set(legalMoves(G.state).filter((move) => move.type === 'play').map((move) => move.card));
  const cards = G.state.hands[player].slice().sort((a, b) => {
    const suitDiff = SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b));
    return suitDiff || RANKS.indexOf(rankOf(a)) - RANKS.indexOf(rankOf(b));
  });
  cards.forEach((held) => {
    const button = document.createElement('button');
    button.className = 'hand-card';
    button.textContent = cardText(held);
    button.setAttribute('aria-label', `Play ${cardText(held)}`);
    styleSuit(button, held);
    const playable = canAct() && G.state.phase === 'playing' && player === G.state.currentPlayer && legalCards.has(held);
    button.disabled = !playable;
    if (playable) button.classList.add('playable');
    button.addEventListener('click', () => performMove({ type: 'play', card: held }));
    handEl.appendChild(button);
  });
}

function renderActions() {
  const state = G.state;
  const bidding = state.phase === 'bidding';
  $('bidControls').classList.toggle('hidden', !bidding || !canAct());
  $('waitMessage').classList.toggle('hidden', canAct() || ['roundEnd', 'gameOver'].includes(state.phase));

  if (bidding) {
    $('turnBanner').textContent = canAct() ? 'NAME YOUR ROAD' : `${playerName(state.currentPlayer).toUpperCase()} IS BIDDING`;
    if (canAct()) renderBidButtons();
    else $('waitMessage').textContent = `Waiting on ${playerName(state.currentPlayer)} to size up the ruts…`;
  } else if (state.phase === 'playing') {
    $('turnBanner').textContent = canAct() ? (state.trick.length ? 'FOLLOW THE LEAD' : 'LEAD THE WAY') : `${playerName(state.currentPlayer).toUpperCase()}'S DRIVE`;
    if (!canAct()) $('waitMessage').textContent = `Waiting on ${playerName(state.currentPlayer)} to pick a line…`;
  } else {
    $('turnBanner').textContent = 'CHECK THE MUD REPORT';
  }
}

function renderBidButtons() {
  const box = $('bidButtons');
  box.replaceChildren();
  const moves = legalMoves(G.state).filter((move) => move.type === 'bid');
  moves.forEach((move) => {
    const button = document.createElement('button');
    button.textContent = String(move.value);
    button.setAttribute('aria-label', `Bid ${move.value} tricks`);
    button.addEventListener('click', () => performMove(move));
    box.appendChild(button);
  });
  $('dealerHook').classList.toggle('hidden', G.state.currentPlayer !== G.state.dealer);
}

function performMove(move) {
  if (!G || !canAct()) return;
  if (!legalMoves(G.state).some((legal) => JSON.stringify(legal) === JSON.stringify(move))) return;
  const previousPlayer = G.state.currentPlayer;
  const next = applyMove(G.state, move);
  G.state = next;

  if (G.mode === 'online') {
    onlineBusy = true;
    render();
    pushOnline(next);
    return;
  }

  if (G.mode === 'pass' && ['bidding', 'playing'].includes(next.phase) &&
      (move.type === 'nextRound' || next.currentPlayer !== previousPlayer)) {
    handRevealed = false;
    render();
    setTimeout(() => showHandoff(next.currentPlayer), move.type === 'play' ? 450 : 180);
    return;
  }

  render();
  scheduleBot();
}

function botStyle(player) {
  return player === 2 ? 'plow' : 'mudflap';
}

function scheduleBot() {
  clearTimeout(botTimer);
  if (!G || G.mode !== 'practice') return;
  if (!['bidding', 'playing'].includes(G.state.phase) || G.state.currentPlayer === 0) return;
  botTimer = setTimeout(() => {
    const move = chooseMove(G.state, botStyle(G.state.currentPlayer));
    G.state = applyMove(G.state, move);
    render();
    scheduleBot();
  }, G.state.phase === 'bidding' ? 480 : 650);
}

function renderScore() {
  const state = G.state;
  const final = state.phase === 'gameOver';
  const summary = state.roundHistory[state.roundHistory.length - 1];
  if (!summary) return;
  $('scoreKicker').textContent = final ? 'FINAL ROAD COMPLETE' : 'ROAD COMPLETE';
  $('scoreRound').textContent = `${summary.handSize} CARD${summary.handSize === 1 ? '' : 'S'}`;
  $('scoreTitle').textContent = final ? 'THE FINAL MUD REPORT' : 'THE MUD REPORT';
  $('scoreSub').textContent = final ? 'Thirteen roads. No clean shoes.' : 'Promises meet pavement.';
  const body = $('scoreBody');
  body.replaceChildren();
  for (let player = 0; player < state.numPlayers; player++) {
    const row = document.createElement('tr');
    const exact = summary.bids[player] === summary.takes[player];
    if (exact) row.classList.add('exact');
    const name = document.createElement('td');
    name.textContent = playerName(player);
    if (exact) {
      const mark = document.createElement('span');
      mark.className = 'exact-mark';
      mark.textContent = '✓ EXACT';
      name.appendChild(mark);
    }
    const bid = document.createElement('td'); bid.textContent = summary.bids[player];
    const got = document.createElement('td'); got.textContent = summary.takes[player];
    const road = document.createElement('td'); road.textContent = `+${summary.points[player]}`;
    const total = document.createElement('td'); total.className = 'total'; total.textContent = summary.scores[player];
    row.append(name, bid, got, road, total);
    body.appendChild(row);
  }

  const winnerLine = $('winnerLine');
  winnerLine.classList.toggle('hidden', !final);
  if (final) {
    const status = getStatus(state);
    const names = status.winners.map(playerName).join(' & ');
    winnerLine.textContent = status.winners.length > 1 ? `${names} share the dry spot!` : `${names} owns the back roads!`;
  }

  const next = $('scoreNext');
  const home = $('scoreHome');
  home.classList.toggle('hidden', !final);
  next.textContent = final ? '↻ DRIVE IT AGAIN' : 'NEXT ROAD →';
  next.disabled = !final && G.mode === 'online' && online.myPlayer !== 0;
  if (next.disabled) next.textContent = 'WAITING FOR THE HOST…';
  scoreOverlay.classList.remove('hidden');
}

$('scoreNext').addEventListener('click', () => {
  if (!G) return;
  if (G.state.phase === 'gameOver') {
    if (G.mode === 'online') onlineRematch();
    else startGame(G.mode, G.state.numPlayers);
    return;
  }
  scoreOverlay.classList.add('hidden');
  performMove({ type: 'nextRound' });
});

$('scoreHome').addEventListener('click', () => goHome($('scoreHome')));

function goHome(source) {
  if (online) {
    if (source.dataset.armed !== '1') {
      source.dataset.armed = '1';
      source.dataset.old = source.textContent;
      source.textContent = 'LEAVE THE CREW?';
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => resetLeave(source), 2500);
      return;
    }
    const match = online.match;
    online = null;
    match.leave();
  }
  clearTimeout(botTimer);
  scoreOverlay.classList.add('hidden');
  showScreen(menu);
  resetLeave(source);
  refreshRejoin();
}

function resetLeave(button) {
  clearTimeout(leaveTimer);
  if (!button) return;
  button.dataset.armed = '';
  if (button.dataset.old) button.textContent = button.dataset.old;
  button.dataset.old = '';
}

$('homeBtn').addEventListener('click', () => goHome($('homeBtn')));

function toggleHelp(show) {
  $('help').classList.toggle('hidden', !show);
}
$('helpBtn').addEventListener('click', () => toggleHelp(true));
$('rulesBtn').addEventListener('click', () => toggleHelp(true));
$('helpClose').addEventListener('click', () => toggleHelp(false));
$('helpDone').addEventListener('click', () => toggleHelp(false));
$('help').addEventListener('click', (event) => { if (event.target === $('help')) toggleHelp(false); });

/* ------------------------------------------------------------- online */

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', () => onlinePanel.classList.add('hidden'));
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinCrew);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((input) => input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') onlineGo();
}));
document.querySelectorAll('.seat-btn').forEach((button) => {
  button.addEventListener('click', () => {
    selectedSeats = Number(button.dataset.seats);
    document.querySelectorAll('.seat-btn').forEach((choice) => {
      const selected = choice === button;
      choice.classList.toggle('selected', selected);
      choice.setAttribute('aria-pressed', String(selected));
    });
  });
});

function openPanel(intent) {
  panelIntent = intent;
  $('opTitle').textContent = intent === 'host' ? 'START A CREW' : 'JOIN A CREW';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'HIT THE ROAD';
  opSeatsWrap.classList.toggle('hidden', intent !== 'host');
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

const FRIENDLY_ERRORS = {
  not_found: 'No crew on that road — double-check the code.',
  room_full: 'That pull-off is already full.',
  room_started: 'That crew already hit the road.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach the road crew — are you online?",
};

function friendly(error) {
  if (error?.code === 'wrong_game') return `That code belongs to ${String(error.detail || 'another game').replace(/-/g, ' ')}.`;
  return FRIENDLY_ERRORS[error?.code] || 'The road washed out — try that again.';
}

async function onlineGo() {
  const go = $('opGo');
  if (go.disabled) return;
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every driver needs a road name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }
  if (panelIntent === 'join' && opCode.value.length !== 4) {
    opError.textContent = 'The road code is 4 characters.';
    opError.classList.remove('hidden');
    opCode.focus();
    return;
  }
  go.disabled = true;
  opError.classList.add('hidden');
  try {
    const match = panelIntent === 'host'
      ? await OnlineMatch.create({
        game: GAME, name, seats: selectedSeats,
        state: createInitialState({ numPlayers: selectedSeats, seed: newSeed() }),
      })
      : await OnlineMatch.join({ game: GAME, code: opCode.value, name });
    onlinePanel.classList.add('hidden');
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (error) {
    opError.textContent = friendly(error);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function renderLobby(match) {
  $('lobbyCode').textContent = match.code;
  const names = $('lobbyNames');
  names.replaceChildren();
  const total = match.state?.numPlayers || selectedSeats;
  for (let seat = 0; seat < total; seat++) {
    const joined = match.seats.find((entry) => entry.seat === seat);
    const item = document.createElement('li');
    item.textContent = joined ? `${joined.name} · Driver ${seat + 1}` : `Waiting for Driver ${seat + 1}…`;
    names.appendChild(item);
  }
}

function openLobby(match) {
  if (lobby._match && lobby._match !== match) lobby._match.stop();
  $('lobbyHint').textContent = 'The rest of the crew joins with this code.';
  lobby._match = match;
  renderLobby(match);
  lobby.classList.remove('hidden');
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobby.classList.add('hidden');
        enterOnlineGame(match);
      } else if (status === 'over') {
        $('lobbyHint').textContent = 'Someone pulled out. Call it off and start a new crew.';
      }
    },
    onPresence: () => renderLobby(match),
    onError: () => {},
  });
}

function cancelLobby() {
  const match = lobby._match;
  if (match) match.leave();
  lobby._match = null;
  lobby.classList.add('hidden');
  refreshRejoin();
}

async function rejoinCrew() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') openLobby(match);
    else enterOnlineGame(match);
  } catch (error) {
    if (['not_found', 'not_seated', 'room_started'].includes(error?.code)) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN YOUR CREW (${saved.code})`;
}

function enterOnlineGame(match) {
  clearTimeout(botTimer);
  online = { match, myPlayer: match.seat };
  G = { mode: 'online', state: match.state };
  onlineBusy = false;
  pollErrors = 0;
  handRevealed = true;
  lobby.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  showScreen(game);
  render();
  match.start({
    onState: (newState) => {
      if (!online) return;
      G.state = newState;
      onlineBusy = false;
      render();
    },
    onStatus: (status) => {
      if (status === 'over' && !getStatus(G.state).over) showDeparture();
    },
    onPresence: (opponents) => {
      pollErrors = 0;
      if (opponents.some((opponent) => opponent.left) && !getStatus(G.state).over) showDeparture();
      else renderDrivers();
    },
    onError: onPollError,
  });
}

async function pushOnline(next) {
  const match = online?.match;
  if (!match) return;
  try {
    await match.push(next, { over: getStatus(next).over });
    if (!online || online.match !== match) return;
    onlineBusy = false;
    render();
  } catch (error) {
    if (!online || online.match !== match) return;
    onlineBusy = false;
    if (error?.code === 'version_conflict') G.state = match.state;
    else $('waitMessage').textContent = friendly(error);
    render();
  }
}

function onPollError(error) {
  if (!online) return;
  if (error?.code === 'not_found') {
    online.match.stop();
    clearSession(GAME);
    online = null;
    scoreOverlay.classList.add('hidden');
    showScreen(menu);
    refreshRejoin();
    return;
  }
  pollErrors++;
  if (pollErrors >= 3) {
    $('waitMessage').textContent = 'CHOPPY ROAD — HANG TIGHT…';
    $('waitMessage').classList.remove('hidden');
  }
}

function showDeparture() {
  scoreOverlay.classList.remove('hidden');
  $('scoreTitle').textContent = 'CREW MEMBER LEFT';
  $('scoreSub').textContent = 'The convoy broke up, so this run is over.';
  $('scoreBody').replaceChildren();
  $('winnerLine').classList.add('hidden');
  $('scoreNext').classList.add('hidden');
  $('scoreHome').classList.remove('hidden');
}

async function onlineRematch() {
  if (!online) return;
  const next = createInitialState({ numPlayers: G.state.numPlayers, seed: newSeed() });
  onlineBusy = true;
  try {
    await online.match.push(next, { over: false });
    G.state = next;
  } catch (error) {
    if (error?.code === 'version_conflict') G.state = online.match.state;
  }
  onlineBusy = false;
  $('scoreNext').classList.remove('hidden');
  scoreOverlay.classList.add('hidden');
  showScreen(game);
  render();
}

/* ----------------------------------------------------- crew-link invites */

$('inviteBtn').addEventListener('click', async () => {
  const match = lobby._match;
  if (!match) return;
  const url = `${location.origin}${location.pathname}?join=${match.code}`;
  const text = `Meet me in Mud Season! 🛻 Bid the back roads with my crew: ${url}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(url);
      $('inviteBtn').textContent = '✓ LINK COPIED';
      setTimeout(() => { $('inviteBtn').textContent = '📲 SEND AN INVITE'; }, 1800);
    }
  } catch { /* Closing the share sheet is not an error. */ }
});

refreshRejoin();

(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  history.replaceState(null, '', location.pathname);
  openPanel('join');
  opCode.value = code.toUpperCase();
  if (opName.value) opCode.focus();
})();
