#!/usr/bin/env bash
#
# Update the live Cardball server.
#
#   sudo /opt/cardball/app/deploy/update.sh              # code, deps, build, restart
#   sudo /opt/cardball/app/deploy/update.sh --import     # also re-import the stats
#   sudo /opt/cardball/app/deploy/update.sh --no-backup  # skip the pre-migration dump
#
# Run it on the server, as root. It is safe to re-run: every step is
# idempotent, and it stops at the first failure instead of pressing on.
#
# Why the user dance: the checkout is owned by `cardball`, so git and pnpm run
# as that user. Only systemctl and pg_dump need root. Nesting `sudo` inside the
# `cardball` shell asks for a password cardball does not have, so the two are
# kept apart deliberately.
set -euo pipefail

APP_DIR=/opt/cardball/app
ENV_FILE=/opt/cardball/.env
SERVICE=cardball
BACKUP_DIR=/opt/cardball/backups
DB_NAME=cardball
RUN_IMPORT=0
DO_BACKUP=1

for arg in "$@"; do
  case "$arg" in
    --import) RUN_IMPORT=1 ;;
    --no-backup) DO_BACKUP=0 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n=== %s ===\n' "$1"; }
die() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }

# Run a command in the repo as the cardball user. NODE_ENV=production would
# otherwise make pnpm skip the dev dependencies the build needs, so it is
# overridden for installs and builds.
as_app() { sudo -u cardball -H bash -lc "cd '$APP_DIR' && $1"; }
with_env() { sudo -u cardball -H bash -lc "set -a; . '$ENV_FILE'; set +a; cd '$APP_DIR' && $1"; }

[ "$(id -u)" -eq 0 ] || die "Run this as root: sudo $0"
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout"
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found"

# ---------------------------------------------------------------------------

step "Before"
BEFORE_COMMIT=$(as_app 'git rev-parse HEAD')
as_app "git log --oneline -1"
echo "branch: $(as_app 'git branch --show-current')"

if [ -n "$(as_app 'git status --porcelain')" ]; then
  as_app 'git status --short'
  die "Uncommitted changes in $APP_DIR. Commit or stash them before updating."
fi

# ---------------------------------------------------------------------------

step "Pull"
as_app 'git pull --ff-only'
AFTER_COMMIT=$(as_app 'git rev-parse HEAD')

if [ "$BEFORE_COMMIT" = "$AFTER_COMMIT" ]; then
  echo "Already at $AFTER_COMMIT — nothing new. Continuing anyway (build and restart are harmless)."
else
  echo "Moving $BEFORE_COMMIT -> $AFTER_COMMIT"
fi

# ---------------------------------------------------------------------------

step "Install"
as_app 'pnpm install --prod=false --frozen-lockfile'

# ---------------------------------------------------------------------------

if [ "$DO_BACKUP" -eq 1 ]; then
  step "Back up the database"
  mkdir -p "$BACKUP_DIR"
  STAMP=$(date +%Y%m%d-%H%M%S)
  DUMP="$BACKUP_DIR/cardball-$STAMP.dump"
  sudo -u postgres pg_dump -Fc "$DB_NAME" -f "$DUMP"
  chown cardball:cardball "$DUMP"
  ls -lh "$DUMP"
  # Keep the five most recent dumps so the directory cannot grow without bound.
  # Read into an array rather than piping `ls` into `xargs`: with `pipefail` a
  # no-match `ls` would fail the pipeline and take the whole script down.
  mapfile -t OLD_DUMPS < <(ls -1t "$BACKUP_DIR"/cardball-*.dump 2>/dev/null | tail -n +6)
  if [ "${#OLD_DUMPS[@]}" -gt 0 ]; then rm -f "${OLD_DUMPS[@]}"; fi
  echo "Rollback: sudo -u postgres pg_restore -d $DB_NAME --clean --if-exists $DUMP"

  # Card photos live on disk under UPLOAD_DIR, not in the database — they need
  # their own copy or a restore would bring back cards with missing art.
  UPLOADS=$(grep -E '^UPLOAD_DIR=' "$ENV_FILE" | head -1 | cut -d= -f2-)
  UPLOADS=${UPLOADS:-/opt/cardball/uploads}
  if [ -d "$UPLOADS" ]; then
    PHOTOS="$BACKUP_DIR/uploads-$STAMP.tar.gz"
    tar -czf "$PHOTOS" -C "$(dirname "$UPLOADS")" "$(basename "$UPLOADS")"
    chown cardball:cardball "$PHOTOS"
    ls -lh "$PHOTOS"
    mapfile -t OLD_PHOTOS < <(ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +6)
    if [ "${#OLD_PHOTOS[@]}" -gt 0 ]; then rm -f "${OLD_PHOTOS[@]}"; fi
  else
    echo "No uploads directory at $UPLOADS to back up."
  fi
else
  step "Back up the database"
  echo "Skipped (--no-backup)."
fi

# ---------------------------------------------------------------------------

step "Migrate"
with_env 'pnpm db:migrate'
sudo -u postgres psql -d "$DB_NAME" -t -c \
  "select 'applied migrations: ' || count(*) from drizzle.__drizzle_migrations"

# ---------------------------------------------------------------------------

if [ "$RUN_IMPORT" -eq 1 ]; then
  step "Import stats (this takes a few minutes)"
  # Upserts people and seasons only; never touches users, cards, teams, or games.
  with_env 'pnpm import:stats'
else
  step "Import stats"
  echo "Skipped. Pass --import when the stats data itself changes"
  echo "(a new Lahman release, or a fix in the importer's transform)."
fi

# ---------------------------------------------------------------------------

# Build before restarting: the frontend on disk is served by the backend, so
# doing these in the other order would pair new HTML with an old bundle.
step "Build the web client"
as_app 'pnpm --filter @cardball/web build'
ls -la "$APP_DIR/apps/web/dist/assets" | head -3

step "Restart the service"
systemctl restart "$SERVICE"
sleep 3
systemctl is-active "$SERVICE" || {
  journalctl -u "$SERVICE" -n 40 --no-pager
  die "$SERVICE failed to start. Roll back with: cd $APP_DIR && sudo -u cardball git reset --hard $BEFORE_COMMIT"
}
journalctl -u "$SERVICE" -n 10 --no-pager

# ---------------------------------------------------------------------------

step "Verify"
HEALTH=$(curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/health || true)
echo "local /api/health: $HEALTH"
[ "$HEALTH" = "200" ] || die "The service is up but not answering on 3001. Check: journalctl -u $SERVICE -n 40"

for route in /api/packs /api/challenges; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001$route" || true)
  # 401 is the healthy answer: the route exists and wants a session.
  echo "$route: $CODE"
  [ "$CODE" = "401" ] || echo "  warning: expected 401 (route present). 404 means the running code is older than the checkout."
done

printf '\nUpdated %s -> %s and restarted %s.\n' "$BEFORE_COMMIT" "$AFTER_COMMIT" "$SERVICE"
