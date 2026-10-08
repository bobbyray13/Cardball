# Deploying Cardball

The live site runs on a Hetzner VPS at `cardball.supertoniic.com`. This folder
holds the pieces that make an update repeatable, so shipping a change is one
command instead of a walkthrough.

## How the server is laid out

| Piece | Where |
| --- | --- |
| Code checkout (owned by `cardball`) | `/opt/cardball/app` |
| Environment file (secrets, `600`) | `/opt/cardball/.env` |
| Uploaded card photos | `/opt/cardball/uploads` |
| Database backups | `/opt/cardball/backups` |
| Built web client | `/opt/cardball/app/apps/web/dist` |
| Service | `cardball.service` (systemd, runs as `cardball`) |
| Database | PostgreSQL on the host, `127.0.0.1:5432`, database `cardball` |
| TLS | Caddy, reverse-proxying `127.0.0.1:3001` |

The server also hosts other services (Coolify, a Cloudflare tunnel). Everything
here stays inside `/opt/cardball` and only touches the `cardball` service.

The Fastify server serves both the API and the built web client, so there is
only one process to restart. That is what `WEB_DIST` points at.

## Routine update

```bash
ssh root@89.167.110.56
sudo /opt/cardball/app/deploy/update.sh
```

That pulls `master`, installs, backs up the database, migrates, builds the web
client, restarts the service, and verifies it came back. It stops at the first
failure rather than pressing on, and it refuses to run over uncommitted changes
in the checkout.

Add `--import` when the stats data itself changed — a new Lahman release, or a
fix in the importer's transform. It re-downloads the source CSVs and upserts
`people` and `seasons`, which takes a few minutes; it never touches users,
cards, teams, or games.

```bash
sudo /opt/cardball/app/deploy/update.sh --import
```

### Why the script is split the way it is

Two things bit us, so the script handles both:

- **`sudo` and the app user.** The checkout is owned by `cardball`, so git and
  pnpm run as that user, while only `systemctl` and `pg_dump` need root. Nesting
  `sudo` inside the `cardball` shell asks for a password that user does not have.
- **Build before restart.** The backend serves the frontend from disk, so
  restarting first would pair a new bundle with an old process. The script
  builds, then restarts.

## Rolling back

Every update writes a dump to `/opt/cardball/backups/` before migrating (the
five most recent are kept). To undo an update:

```bash
cd /opt/cardball/app
sudo -u cardball git log --oneline -5          # find the previous commit
sudo -u cardball git reset --hard <commit>
sudo -u cardball -H bash -lc 'cd /opt/cardball/app && pnpm install --prod=false'
sudo -u cardball -H bash -lc 'cd /opt/cardball/app && pnpm --filter @cardball/web build'
sudo systemctl restart cardball

# only if the release changed the schema
sudo -u postgres pg_restore -d cardball --clean --if-exists \
  /opt/cardball/backups/cardball-<stamp>.dump
```

## First-time setup on a fresh server

For reference, and for rebuilding the box from scratch.

```bash
# 1. Node 22+ and pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs
corepack enable && corepack prepare pnpm@10 --activate

# 2. A user to own the app, and the checkout
useradd -r -m -d /opt/cardball -s /bin/bash cardball
sudo -u cardball git clone https://github.com/bobbyray13/Cardball.git /opt/cardball/app

# 3. PostgreSQL on the host
apt-get install -y postgresql
sudo -u postgres psql -c "create user cardball password '<password>';"
sudo -u postgres psql -c "create database cardball owner cardball;"

# 4. The environment file (600, owned by cardball)
cat >/opt/cardball/.env <<'EOF'
DATABASE_URL=postgres://cardball:<password>@127.0.0.1:5432/cardball
NODE_ENV=production
PORT=3001
HOST=127.0.0.1
COOKIE_SECURE=true
UPLOAD_DIR=/opt/cardball/uploads
WEB_DIST=/opt/cardball/app/apps/web/dist
EOF
chown cardball:cardball /opt/cardball/.env && chmod 600 /opt/cardball/.env

# 5. Dependencies, schema, stats, web client
sudo -u cardball -H bash -lc 'cd /opt/cardball/app && pnpm install --prod=false'
sudo -u cardball -H bash -lc 'set -a; . /opt/cardball/.env; set +a; cd /opt/cardball/app && pnpm db:migrate'
sudo -u cardball -H bash -lc 'set -a; . /opt/cardball/.env; set +a; cd /opt/cardball/app && pnpm import:stats'
sudo -u cardball -H bash -lc 'cd /opt/cardball/app && pnpm --filter @cardball/web build'

# 6. The service
cp /opt/cardball/app/deploy/cardball.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cardball

# 7. TLS
cp /opt/cardball/app/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

Notes worth remembering:

- The app listens on `127.0.0.1:3001` only. Caddy terminates TLS and is the only
  thing exposed. Do not open 3001 or 5432 in the firewall.
- `UPLOAD_DIR` is a real directory on the box, not in the repo. Back it up
  alongside the database if card photos matter.
- The dev database is a Docker container on port **5433**; production is the
  host's PostgreSQL on **5432**. They are separate, and a `docker compose`
  command run on the server does nothing to production.

## Troubleshooting

**The site is up but a new route 404s.** The running process is older than the
checkout — the restart did not happen. `systemctl restart cardball`.

**`dubious ownership in repository`.** Git is being run as root against a
`cardball`-owned checkout. Use `sudo -u cardball -H bash -lc 'cd /opt/cardball/app && …'`.

**`sudo: a password is required` for the `cardball` user.** A `sudo` is nested
inside a command already running as `cardball`. Split it: repo commands as
`cardball`, service commands as root.

**Checking what is actually running:**

```bash
systemctl status cardball --no-pager
journalctl -u cardball -n 50 --no-pager
cd /opt/cardball/app && sudo -u cardball git log --oneline -1
sudo -u postgres psql -d cardball -t -c 'select count(*) from drizzle.__drizzle_migrations'
```
