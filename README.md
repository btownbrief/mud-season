# Mud Season

Mud Season is Btown Games' Vermont take on **Oh Hell**, the public-domain trick-taking game. Three or four drivers bid how many tricks they will take, follow suit, and try to hit that number exactly over 13 quick rounds: 7 cards down to 1, then back to 7.

## Play

Open `index.html` from a static web server. There is no build step and no package install.

- **Practice Run:** one human seat with Mudflap and Town Plow filling the convoy.
- **Pass & Play:** three or four people share one phone; handoff screens hide each hand.
- **Online:** three or four phones share a 4-letter room code through the fleet rooms layer.

Scoring is classic Oh Hell: an exact bid earns 10 plus tricks taken; a missed bid earns only the tricks taken. The dealer bids last and cannot make total bids equal the tricks in the hand (the classic “screw the dealer” hook).

## Architecture

- `js/engine.js` contains every rule as pure functions over one JSON-safe state object.
- `js/bot.js` chooses only from the engine's legal moves.
- `js/main.js` renders the table and moves state through local or online play.
- `js/rooms.js` and `scripts/rooms-shim.mjs` are untouched fleet-vendored multiplayer files.

## Verification

```sh
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
```
