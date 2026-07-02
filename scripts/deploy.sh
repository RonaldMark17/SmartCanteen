#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${SMARTCANTEEN_APP_DIR:-/var/www/smartcanteen}"
BRANCH="${SMARTCANTEEN_BRANCH:-main}"
BACKEND_SERVICE="${SMARTCANTEEN_BACKEND_SERVICE:-smartcanteen}"
NGINX_SERVICE="${SMARTCANTEEN_NGINX_SERVICE:-nginx}"
HEALTHCHECK_URL="${SMARTCANTEEN_HEALTHCHECK_URL:-http://127.0.0.1:8000/api/health}"
PYTHON_BIN="${SMARTCANTEEN_PYTHON_BIN:-python3}"
FRONTEND_DIR="${SMARTCANTEEN_FRONTEND_DIR:-$APP_DIR/smartcanteen}"
PUBLIC_DIST_DIR="${SMARTCANTEEN_PUBLIC_DIST_DIR:-$APP_DIR/dist}"
BACKUP_DIR="${SMARTCANTEEN_BACKUP_DIR:-$APP_DIR/.deploy-backups}"
VENV_DIR="${SMARTCANTEEN_VENV_DIR:-$APP_DIR/venv}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"

if [ "$(id -u)" -eq 0 ]; then
  SUDO_CMD=()
else
  if [ -n "${SMARTCANTEEN_SUDO:-}" ]; then
    # shellcheck disable=SC2206
    SUDO_CMD=($SMARTCANTEEN_SUDO)
  else
    SUDO_CMD=(sudo -n)
  fi
fi

run_sudo() {
  if [ "${#SUDO_CMD[@]}" -gt 0 ]; then
    "${SUDO_CMD[@]}" "$@"
  else
    "$@"
  fi
}

section() {
  printf '\n==> %s\n' "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

section "Checking deployment prerequisites"
require_command git
require_command npm
require_command curl
require_command "$PYTHON_BIN"

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Deployment directory is not a git repository: $APP_DIR" >&2
  echo "Set SMARTCANTEEN_APP_DIR or SERVER_APP_DIR to the checked-out SmartCanteen repository." >&2
  exit 1
fi

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"
PREVIOUS_REVISION="$(git rev-parse --short HEAD 2>/dev/null || true)"

section "Creating deployment backup"
if [ -n "$PREVIOUS_REVISION" ]; then
  printf '%s\n' "$PREVIOUS_REVISION" > "$BACKUP_DIR/last-successful-revision"
fi

if [ -d "$PUBLIC_DIST_DIR" ]; then
  tar -C "$PUBLIC_DIST_DIR" -czf "$BACKUP_DIR/public-dist-$TIMESTAMP.tgz" . || true
fi

if [ -f "$APP_DIR/canteen.db" ]; then
  cp -p "$APP_DIR/canteen.db" "$BACKUP_DIR/canteen.db-$TIMESTAMP" || true
fi

section "Pulling latest code"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
CURRENT_REVISION="$(git rev-parse --short HEAD)"

section "Installing backend dependencies"
if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt

section "Checking backend syntax"
python -m compileall -q backend smartcanteen/src/services

section "Installing frontend dependencies"
cd "$FRONTEND_DIR"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

section "Building frontend"
npm run build

section "Publishing frontend"
FRONTEND_DIST_DIR="$FRONTEND_DIR/dist"
if [ ! -d "$FRONTEND_DIST_DIR" ]; then
  echo "Frontend build output not found: $FRONTEND_DIST_DIR" >&2
  exit 1
fi

if [ "$(realpath "$FRONTEND_DIST_DIR")" != "$(realpath -m "$PUBLIC_DIST_DIR")" ]; then
  mkdir -p "$PUBLIC_DIST_DIR"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$FRONTEND_DIST_DIR"/ "$PUBLIC_DIST_DIR"/
  else
    tmp_dist="${PUBLIC_DIST_DIR}.tmp-$TIMESTAMP"
    rm -rf "$tmp_dist"
    mkdir -p "$tmp_dist"
    cp -a "$FRONTEND_DIST_DIR"/. "$tmp_dist"/
    rm -rf "$PUBLIC_DIST_DIR"
    mv "$tmp_dist" "$PUBLIC_DIST_DIR"
  fi
fi

section "Restarting backend service"
run_sudo systemctl restart "$BACKEND_SERVICE"
run_sudo systemctl --no-pager --full status "$BACKEND_SERVICE"

section "Reloading Nginx"
run_sudo nginx -t
run_sudo systemctl reload "$NGINX_SERVICE"

section "Verifying application health"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$HEALTHCHECK_URL" >/dev/null; then
    echo "Health check passed: $HEALTHCHECK_URL"
    echo "Deployed SmartCanteen revision $CURRENT_REVISION"
    exit 0
  fi
  echo "Health check attempt $attempt failed; retrying..."
  sleep 3
done

echo "Deployment completed, but health check failed: $HEALTHCHECK_URL" >&2
echo "Previous revision before deploy: ${PREVIOUS_REVISION:-unknown}" >&2
echo "Backups are stored in: $BACKUP_DIR" >&2
exit 1
