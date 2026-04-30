#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/delegat-transport"
APP_NAME="${APP_NAME:-dedrive-app}"
BRANCH="${BRANCH:-main}"

echo "==> Deploy start ($(date))"
echo "    App dir : $APP_DIR"
echo "    App name: $APP_NAME"
echo "    Branch  : $BRANCH"

if ! command -v git >/dev/null 2>&1; then
  echo "ERROR: git is not installed."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed."
  exit 1
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: pm2 is not installed."
  exit 1
fi

cd "$APP_DIR"

# Ensure this path is accepted by git when ownership differs.
git config --global --add safe.directory "$APP_DIR" || true

echo "==> Fetch latest from origin/$BRANCH"
git fetch origin
git reset --hard "origin/$BRANCH"

echo "==> Install dependencies"
npm install

echo "==> Build"
npm run build

echo "==> Restart PM2 app: $APP_NAME"
pm2 restart "$APP_NAME"
pm2 save

echo "==> Health check"
sleep 1
curl -fsS "http://127.0.0.1:3000/api/health" || true
echo
echo "==> Deploy done ($(date))"
