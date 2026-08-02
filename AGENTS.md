# Mud Season — agent instructions

Shared brain for any AI agent working in this repo. Read `README.md` first. Stephen is non-technical, so explain consequential changes in plain language.

## What this is

Btown's Vermont-themed Oh Hell. Plain static site, **no build step**: `index.html` + `style.css` + ES modules in `js/`. Deployed by GitHub Pages via `.github/workflows/deploy.yml` on push. No backend, accounts, analytics, or ads.

## The one non-negotiable

Every game rule lives in `js/engine.js` as pure functions over one plain JSON-serializable state object. `engine.js` imports nothing and never touches the DOM, timers, `Date`, or `Math.random`. `applyMove` returns a **new** state. Shuffle randomness uses a seeded RNG stored inside state so every phone replays identically. `js/bot.js` may only choose from the engine's public API; `js/main.js` is UI only.

## Online play (the rooms layer)

`js/rooms.js` is the fleet's vendored online-multiplayer client; its canonical copy lives in `four-in-a-rowboat` and must never be edited here. It syncs the entire engine state as opaque JSON with version checks. Seat index equals engine player index and the host sits in seat 0. Hidden hands are redacted by the honest UI, though full friendly-game state reaches every phone.

`scripts/rooms-shim.mjs` is the verbatim canonical local stand-in. `scripts/test-rooms.mjs` drives the real client, shim referee, and game engine through synchronized three- and four-phone games.

Keep the mandated online IDs and crew-link invite behavior described in `four-in-a-rowboat/ROOMS-INTEGRATION.md`.

## Before you finish

Run all of these and report what passed:

```sh
node scripts/test-engine.mjs
node scripts/test-rooms.mjs
node --check js/engine.js
node --check js/bot.js
node --check js/main.js
```

If the UI changed, inspect it at a phone-sized viewport and exercise practice and pass-and-play, or state clearly what could not be tested.
