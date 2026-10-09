# Baseball Cardball

Play the tabletop dice game with your real baseball cards, online. Collect
cards built from real MLB history (any player, any season), tear open themed
packs, draft with friends, and manage a lineup through a paced dice game where
every pitch is an opposed roll and the commissioner tunes the league's house
rules.

## What's in the game

- **Collection & cards** — add any player-season as a card (or photograph your
  physical card and use that art), sort a binder with five rarity tiers, and
  file duplicates as copies.
- **Packs** — claim starter packs, win themed packs from games, feats
  (no-hitters, cycles), historic collections, and tournaments.
- **Teams** — build rosters up to 26 cards, set lineups and fielding positions,
  or let the auto-lineup do it.
- **Games** — remote (with spectators, chat, and optional passwords), hotseat,
  or vs. a bot; paced pitch-by-pitch play with steals, sends, double plays,
  substitutions, fatigue, and a live box score.
- **Drafts** — pass-the-pack draft rooms with era and rarity rules; play a
  series, keep a card per win.
- **Tournaments** — draft once, then play a round-robin or knockout schedule;
  the host can auto-simulate matches.
- **Challenges** — collect all 30 historic franchise lineups for pack rewards.
- **House rules** — every tunable number in the dice math (stat bands, fatigue,
  walk and double-play rules, the spray chart) lives in one commissioner-editable
  rule set, snapshotted into each game so rules can't change mid-game.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/web` | React 19 + Vite client (Tailwind v4, framer-motion, socket.io-client) |
| `apps/server` | Fastify 5 API + Socket.IO realtime; serves the built web client in production |
| `packages/engine` | The pure game engine: actions in, new state + event log out |
| `packages/shared` | Types and rule tables shared by server, web, and engine |
| `packages/db` | Drizzle ORM schema and migrations for PostgreSQL |
| `tools/import-stats` | Imports the Baseball Databank (Lahman) CSVs into `people` and `seasons` |
| `deploy` | Production runbook, systemd unit, Caddy config, `update.sh` |

## Getting started

Requires Node 22+ and pnpm 10 (via corepack). Docker runs the dev database.

```bash
pnpm install
docker compose up -d postgres    # Postgres 17 on localhost:5433
pnpm db:migrate                  # create the schema
pnpm import:stats                # one-time: load ~150 seasons of MLB stats (a few minutes)
pnpm dev                         # server on :3001, web on the Vite dev server
```

The first account registered on a fresh server becomes the commissioner and can
mint invite codes; everyone after needs one.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run the server and web client together |
| `pnpm build` | Build all packages (includes the web client into `apps/web/dist`) |
| `pnpm test` | Run every test suite (server suites spin up throwaway databases) |
| `pnpm typecheck` | TypeScript project checks |
| `pnpm lint` | Lint all packages |
| `pnpm db:generate` | Generate a Drizzle migration after editing `packages/db/src/schema.ts` |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Browse the dev database |
| `pnpm import:stats` | Download and upsert the Baseball Databank |

## Testing

Each package has its own vitest suite. The server and draft/tournament suites
run against a real PostgreSQL (the dev container is enough). The engine keeps
simulation and soak tests (hundreds of bot-vs-bot games with invariant checks)
that the gameplay suites build on. Run everything with `pnpm test`.

## Production

The live site is a single Hetzner VPS: systemd runs the Fastify server, Caddy
terminates TLS, PostgreSQL runs on the host. `deploy/update.sh` pulls, installs,
backs up, migrates, builds, restarts, and verifies — see `deploy/README.md`
for the full runbook, first-time setup, and rollback.

## Credits

Player statistics come from the [Baseball Databank](https://github.com/chadwickbureau/baseballdatabank)
(Lahman-style CSVs, 1871–present). Nothing here is affiliated with or endorsed
by MLB.

See `STYLEGUIDE.md` for the coding conventions used across the repo.
