#!/usr/bin/env bash
#
# deploy.sh — build & deploy the File Transfer App to the production server.
#
# Architecture (matches the apps.trisysit.com Apache vhost):
#   • Frontend  : built React app served by Apache from   $WEB_ROOT
#                 (Alias /file-transfer "/var/www/html/file-transfer/")
#   • Backend   : Node/Express API served from            $APP_DIR
#                 (Apache proxies /file-transfer/api/ -> http://localhost:3001/api/)
#
# What this script does:
#   1. Builds the frontend locally   (yarn build  ->  dist/)
#   2. rsyncs dist/  ->  Apache web root        (preserves nothing else there)
#   3. rsyncs backend source -> app dir
#        (EXCLUDES .env, data/, uploads/, node_modules/, dist/ so live
#         secrets, users, and uploaded files are NEVER overwritten)
#   4. Optionally runs `yarn install` on the server   (--install)
#   5. Restarts the Node process (auto-detects pm2 / systemd / nohup)
#   6. Health-checks the API
#
# Usage:
#   ./deploy.sh                 # full deploy (frontend + backend + restart)
#   ./deploy.sh --backend-only  # only server.cjs + backend, restart Node
#   ./deploy.sh --frontend-only # only rebuild + push the React app
#   ./deploy.sh --install       # also run `yarn install --immutable` on the server
#   ./deploy.sh --dry-run       # show what rsync WOULD do, change nothing
#   ./deploy.sh --no-restart    # skip the Node restart
#
# Override any setting inline, e.g.:
#   SERVER_HOST=10.8.0.1 ./deploy.sh
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------
SERVER_USER="${SERVER_USER:-jimut}"
SERVER_HOST="${SERVER_HOST:-10.10.1.107}"
SSH_PORT="${SSH_PORT:-22}"
APP_DIR="${APP_DIR:-/home/jimut/file-transfer-app}"          # Node backend lives here
WEB_ROOT="${WEB_ROOT:-/var/www/html/file-transfer}"          # Apache serves the SPA from here
SERVICE_NAME="${SERVICE_NAME:-file-transfer}"                # pm2 / systemd unit name
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/api/stats}"  # checked on the server after restart

SSH="ssh -p ${SSH_PORT} ${SERVER_USER}@${SERVER_HOST}"
# TTY-allocating variant — required for any remote command that runs `sudo`,
# otherwise sudo can't prompt for a password over a non-interactive SSH session.
SSH_TTY="ssh -t -p ${SSH_PORT} ${SERVER_USER}@${SERVER_HOST}"
TARGET="${SERVER_USER}@${SERVER_HOST}"

# ---------------------------------------------------------------------------
# Flags
# ---------------------------------------------------------------------------
DO_FRONTEND=1
DO_BACKEND=1
DO_RESTART=1
DO_INSTALL=0
DRY_RUN=""
RSYNC_FLAGS="-az"

for arg in "$@"; do
  case "$arg" in
    --frontend-only) DO_BACKEND=0 ;;
    --backend-only)  DO_FRONTEND=0 ;;
    --no-restart)    DO_RESTART=0 ;;
    --install)       DO_INSTALL=1 ;;
    --dry-run)       DRY_RUN="--dry-run"; RSYNC_FLAGS="-az --itemize-changes" ;;
    -h|--help)       grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (use --help)"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Pretty output
# ---------------------------------------------------------------------------
c_grn='\033[0;32m'; c_yel='\033[0;33m'; c_red='\033[0;31m'; c_off='\033[0m'
say()  { echo -e "${c_grn}==>${c_off} $*"; }
warn() { echo -e "${c_yel}!!${c_off} $*"; }
die()  { echo -e "${c_red}xx${c_off} $*" >&2; exit 1; }

cd "$(dirname "$0")"   # always run from the project root

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
command -v rsync >/dev/null || die "rsync not found on this machine"
[ -f server.cjs ]  || die "server.cjs not found — run this from the project root"

say "Deploy target: ${TARGET}:${SSH_PORT}"
say "  backend  -> ${APP_DIR}"
say "  frontend -> ${WEB_ROOT}"
[ -n "$DRY_RUN" ] && warn "DRY RUN — no files will actually be written"

say "Checking SSH connectivity..."
$SSH "echo connected" >/dev/null 2>&1 || die "Cannot SSH to ${TARGET}. Are you on the LAN/VPN?"

# ---------------------------------------------------------------------------
# 1. Frontend: build + deploy to Apache web root
# ---------------------------------------------------------------------------
if [ "$DO_FRONTEND" -eq 1 ]; then
  say "Building frontend (yarn build)..."
  yarn build
  [ -d dist ] || die "build produced no dist/ directory"

  # Stage in the user's home (writable without sudo), then sudo-move into the
  # Apache web root. --delete clears stale hashed asset chunks from old builds.
  STAGING="/home/${SERVER_USER}/.deploy-ft-dist"
  say "Uploading dist/ to staging on server..."
  rsync $RSYNC_FLAGS --delete $DRY_RUN -e "ssh -p ${SSH_PORT}" dist/ "${TARGET}:${STAGING}/"

  if [ -z "$DRY_RUN" ]; then
    say "Publishing to web root (sudo on server)..."
    $SSH_TTY "sudo mkdir -p '${WEB_ROOT}' && \
          sudo rsync -a --delete '${STAGING}/' '${WEB_ROOT}/' && \
          sudo chown -R www-data:www-data '${WEB_ROOT}' && \
          rm -rf '${STAGING}'"
  fi
  say "Frontend deployed."
fi

# ---------------------------------------------------------------------------
# 2. Backend: sync source (protecting live runtime data)
# ---------------------------------------------------------------------------
if [ "$DO_BACKEND" -eq 1 ]; then
  say "Syncing backend to ${APP_DIR}..."
  # NOTE: trailing slash on source = copy contents. Excludes keep live
  # secrets / users / uploads / installed deps intact on the server.
  rsync $RSYNC_FLAGS $DRY_RUN -e "ssh -p ${SSH_PORT}" \
    --exclude='.git/' \
    --exclude='.github/' \
    --exclude='.claude/' \
    --exclude='node_modules/' \
    --exclude='dist/' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='data/' \
    --exclude='uploads/' \
    --exclude='deploy.sh' \
    --exclude='*.log' \
    --exclude='.DS_Store' \
    ./ "${TARGET}:${APP_DIR}/"
  say "Backend synced."

  if [ "$DO_INSTALL" -eq 1 ] && [ -z "$DRY_RUN" ]; then
    say "Installing production dependencies on server (yarn install)..."
    # yarn install on the server so bcrypt's native binary matches the server arch
    $SSH "cd '${APP_DIR}' && yarn install --immutable"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Restart Node (auto-detect process manager)
# ---------------------------------------------------------------------------
if [ "$DO_RESTART" -eq 1 ] && [ "$DO_BACKEND" -eq 1 ] && [ -z "$DRY_RUN" ]; then
  say "Restarting Node backend..."
  $SSH_TTY "set -e
    cd '${APP_DIR}'
    if command -v pm2 >/dev/null 2>&1 && pm2 describe '${SERVICE_NAME}' >/dev/null 2>&1; then
      echo 'Restarting via pm2'; pm2 restart '${SERVICE_NAME}'
    elif systemctl list-unit-files 2>/dev/null | grep -q '^${SERVICE_NAME}\.service'; then
      echo 'Restarting via systemd'; sudo systemctl restart '${SERVICE_NAME}'
    else
      echo 'Restarting via nohup'
      pkill -f 'node server.cjs' 2>/dev/null || true
      sleep 1
      # setsid fully detaches from the (TTY) session so the process survives
      # the SSH disconnect; nohup + redirect keeps it alive and logged.
      NODE_ENV=production setsid nohup node server.cjs > server.log 2>&1 < /dev/null &
      sleep 1
    fi"
  say "Restart issued."

  # ---- Health check ----
  say "Health-checking ${HEALTH_URL} ..."
  # /api/stats requires auth, so a healthy server returns 401 (not 200) — accept both.
  # systemd takes a moment to stop the old process and rebind the port, so poll
  # with a few retries instead of curling once and racing the restart.
  if $SSH "for i in 1 2 3 4 5 6; do
             code=\$(curl -sS -o /dev/null -w '%{http_code}' '${HEALTH_URL}' 2>/dev/null || true)
             case \"\$code\" in 200|401) echo \"healthy (HTTP \$code)\"; exit 0;; esac
             sleep 1
           done
           exit 1"; then
    say "Backend is up. ✅"
  else
    warn "Health check did not return 200/401 after ~6s — check logs:"
    warn "  $SSH 'sudo journalctl -u ${SERVICE_NAME} -n 40 --no-pager'"
  fi
fi

say "Done."
[ -n "$DRY_RUN" ] && warn "That was a dry run. Re-run without --dry-run to apply."
