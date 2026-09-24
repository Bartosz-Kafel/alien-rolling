# AFK Alien Dice

An incremental Alien collection game with server-authoritative rolls, inventory, economy, equipment, and trades.

## Run

1. Set `DATABASE_URL` to the Supabase PostgreSQL connection string.
2. Run [`migrations/20260912_alien_dice_rework.sql`](migrations/20260912_alien_dice_rework.sql) once in Supabase.
3. Run `npm start`.

Roll Drive level 0 rolls with a 2.0s reveal that eases exponentially to its 0.5s floor, effectively reached at level 100.

`npm test` validates permanent IDs, the 2,500-entry catalog, endgame rarity, stack identity, ranking, and economy curves. `npm run simulate:economy` prints deterministic early-to-endgame balance snapshots. `npm run generate:aliens` is append-safe for catalog maintenance; use `--force` only before an initial unreleased catalog is deployed.

## Architecture

- [`data/alien-registry.json`](data/alien-registry.json) is checked-in, immutable content. It contains 2,500 actual alien definitions.
- [`scripts/generate-aliens.js`](scripts/generate-aliens.js) generates new permanent definitions from compact naming/content pools without changing existing IDs or names.
- [`balance.js`](balance.js) owns all server-side tuning: upgrade curves, Dice Quantity, income, Shiny value, power ranking, and Luck probability transforms.
- [`server.js`](server.js) validates every state change, serializes mutations, and persists each account update transactionally. Session records are persistent and a login invalidates previous sessions for that account.
- [`public/numbers.js`](public/numbers.js) is the one presentation formatter for coins, Luck, chances, statistics, and large numbers.
- [`public/sounds.js`](public/sounds.js) is the sole audio bus. Gameplay/UI code only calls `playSound(name)`.

## Luck model

Every Alien has an immutable base chance `1 / N`. For a roll with effective Luck `L`, the server samples each Alien from its immutable base weight raised to:

`max(0.025, L ^ -0.55)`

This makes scarcer entries increasingly reachable without making all rarities linearly more likely. The exponent floor preserves exceptional endgame odds. Effective Luck is:

`permanent Luck × (1 + pending sacrifice Luck)`

Pending Luck is written atomically with the selected inventory consumption, then cleared only after a successful server roll.

### Temporary Luck guarantee

Pending Luck also converts into a server-authoritative **rarity floor** for the next roll's dice: `log10(1 + pending) − 1.5`, capped at log 20, and it only becomes active once it can bind above the catalog's mildest rarity (about 60 common aliens). Roughly 100 commons guarantee ~1/790, and roughly 1,000 commons guarantee ~1/7,900. When a draw lands below the floor it is resampled once, then filled from the mildest decade band above the floor so the promise never collapses onto one identical alien. The weight transform above is untouched.

## Manual sound placement

The default procedural calls are already installed. To replace or add assets, edit only [`public/sounds.js`](public/sounds.js), then use these existing call sites in [`public/app.js`](public/app.js):

- `animateRoll()` — `playSound("rollStart")` immediately after the dice receives `is-rolling`; `playSound("rollTick")` inside each scan frame; `playSound("rollReveal")` immediately after the final result is rendered.
- `animateRoll()` — `playSound("rareReveal")` immediately after the normal reveal for an Alien with `baseChanceLog >= 10`.
- `showDiscovery()` — `playSound("discovery")` before the full-screen discovery card is opened.
- Shop, sacrifice, and merging handlers — pass `sound: "purchase"` or `sound: "merge"` to `act()` at the action request, so the sound follows a confirmed server mutation rather than a speculative click.
- `equipBestButton` handler — `sound: "equip"` is passed to `act()` immediately before the short team replacement animation.
- `pulseAlienBox()` — `playSound("alienMoney")` fires with the client-only laser/coin effect, after a randomly selected equipped Alien begins its earning pulse.

## Debug mode

Development-only grants are available only when both `NODE_ENV` is not `production` and `DEBUG_GAME=true`. Production does not register the endpoint.
