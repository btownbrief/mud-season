// Drives the real vendored rooms client against the local canonical shim,
// including complete three- and four-phone Mud Season matches.

import { createRooms } from './rooms-shim.mjs';
import { createInitialState, legalMoves, applyMove, getStatus } from '../js/engine.js';

const GAME = 'mud-season';
const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (key) => stores.get(current)?.get(key) ?? null,
  setItem: (key, value) => stores.get(current).set(key, String(value)),
  removeItem: (key) => stores.get(current).delete(key),
};
function device(id) {
  if (!stores.has(id)) stores.set(id, new Map());
  current = id;
}
for (const id of ['A', 'B', 'C', 'D', 'E']) device(id);
device('A');

let passed = 0;
function t(condition, label) {
  if (!condition) { console.error(`FAIL: ${label}`); process.exit(1); }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try { await promise; t(false, `${label} (no error)`); }
  catch (error) { t(error?.code === code, `${label} (got ${error?.code})`); }
}

let randomState = 0x8badf00d;
function choose(items) {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return items[randomState % items.length];
}

const shim = createRooms();
let backendReady = true;
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
globalThis.fetch = async (url, options = {}) => {
  if (!backendReady) return new Response('{}', { status: 404 });
  const match = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/);
  if ((options.method || 'GET') !== 'POST' || !match || !shim.rpcs[match[1]]) {
    return new Response(JSON.stringify({ message: 'not a room rpc' }), { status: 404 });
  }
  try {
    const body = shim.rpcs[match[1]](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ message: error.message }), {
      status: error.rpc ? 400 : 500, headers: { 'Content-Type': 'application/json' },
    });
  }
};

const { OnlineMatch, savedSession, RoomsError } = await import('../js/rooms.js');

async function sync(phones) {
  for (const phone of phones) { device(phone.device); await phone.match._fetch(); }
  const truth = JSON.stringify(phones[0].match.state);
  return phones.every((phone) => JSON.stringify(phone.match.state) === truth);
}

async function playMatch(phones, cap = 500) {
  let moves = 0;
  let synced = await sync(phones);
  while (!getStatus(phones[0].match.state).over && moves < cap) {
    const state = phones[0].match.state;
    const phone = phones.find((candidate) => candidate.match.seat === state.currentPlayer);
    if (!phone) throw new Error(`No phone for seat ${state.currentPlayer}`);
    device(phone.device);
    await phone.match._fetch();
    const next = applyMove(phone.match.state, choose(legalMoves(phone.match.state)));
    await phone.match.push(next, { over: getStatus(next).over });
    moves++;
    synced = await sync(phones);
    if (!synced) break;
  }
  return { moves, synced, finished: getStatus(phones[0].match.state).over };
}

// Generic room checks plus a full three-phone match.
device('A');
const host3 = await OnlineMatch.create({
  game: GAME, name: 'Winooski', seats: 3,
  state: createInitialState({ numPlayers: 3, seed: 101 }),
});
t(/^[A-Z2-9]{4}$/.test(host3.code) && host3.seat === 0 && host3.status === 'waiting', 'host creates a three-seat room in seat 0');
t(savedSession(GAME)?.roomId === host3.roomId, 'host session is saved');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'Lost' }), 'not_found', 'bad code is rejected');
await expectCode(OnlineMatch.join({ game: 'crazy-eights', code: host3.code, name: 'Wrong' }), 'wrong_game', 'wrong game is rejected');
const guest3b = await OnlineMatch.join({ game: GAME, code: ` ${host3.code.toLowerCase()} `, name: 'Richmond' });
t(guest3b.seat === 1 && guest3b.status === 'waiting', 'second phone joins and room keeps waiting');
device('C');
const guest3c = await OnlineMatch.join({ game: GAME, code: host3.code, name: 'Jericho' });
t(guest3c.seat === 2 && guest3c.status === 'playing', 'third phone fills and starts the room');

device('A');
await host3._fetch();
t(host3.status === 'playing' && host3.opponents().length === 2, 'host sees both online rivals');
const firstState = applyMove(host3.state, choose(legalMoves(host3.state)));
await host3.push(firstState);
t(host3.version === 1, 'host publishes the first engine move');

device('B');
await guest3b._fetch();
const stale = guest3b.state;
device('C');
await guest3c._fetch();
const freshState = applyMove(guest3c.state, choose(legalMoves(guest3c.state)));
await guest3c.push(freshState);
device('B');
await expectCode(guest3b.push(applyMove(stale, choose(legalMoves(stale)))), 'version_conflict', 'stale state push is rejected');
t(JSON.stringify(guest3b.state) === JSON.stringify(guest3c.state), 'conflict fetches server truth');
t(new RoomsError('offline').code === 'offline', 'room failures carry stable codes');

const three = await playMatch([
  { device: 'A', match: host3 }, { device: 'B', match: guest3b }, { device: 'C', match: guest3c },
]);
t(three.synced, 'three phones remain JSON-identical after every move');
t(three.finished, `three-phone match reaches game over in ${three.moves + 2} moves`);
t(host3.status === 'over', 'room status matches engine game over');

device('B');
const rematchVersion = guest3b.version;
await guest3b.push(createInitialState({ numPlayers: 3, seed: 202 }), {});
t(guest3b.status === 'playing' && guest3b.version === rematchVersion + 1, 'finished room accepts a rematch deal');
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
t(resumed.roomId === host3.roomId && resumed.seat === 0, 'saved host resumes the same seat');
await resumed.leave();
t(savedSession(GAME) === null, 'leaving clears the room session');

// Full four-phone match and capacity check.
device('A');
const host4 = await OnlineMatch.create({
  game: GAME, name: 'A', seats: 4,
  state: createInitialState({ numPlayers: 4, seed: 303 }),
});
const phones4 = [{ device: 'A', match: host4 }];
for (const [id, name] of [['B', 'B'], ['C', 'C'], ['D', 'D']]) {
  device(id);
  phones4.push({ device: id, match: await OnlineMatch.join({ game: GAME, code: host4.code, name }) });
}
t(phones4[2].match.status === 'waiting' && phones4[3].match.status === 'playing', 'four-seat room starts only when the fourth phone joins');
device('E');
await expectCode(OnlineMatch.join({ game: GAME, code: host4.code, name: 'Too Late' }), 'room_started', 'fifth phone cannot join a started room');
const four = await playMatch(phones4);
t(four.synced, 'four phones remain JSON-identical after every move');
t(four.finished, `four-phone match reaches game over in ${four.moves} moves`);
t(host4.state.numPlayers === 4 && host4.state.hands.length === 4, 'online state preserves all four engine seats');

backendReady = false;
const absent = await import('../js/rooms.js?not-ready');
device('E');
await expectCode(absent.OnlineMatch.create({ game: GAME, name: 'A', state: {} }), 'not_ready', 'missing backend reports not_ready');

console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
process.exit(0);
