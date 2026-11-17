#!/usr/bin/env bash
# Pull the latest main, build, migrate and restart. Run as root (sudo) on the VPS:
#   sudo /srv/operandis/app/deploy/update.sh
set -euo pipefail
APP=/srv/operandis/app
ENV_FILE=/srv/operandis/operandis.env
BACKUP_DIR=/srv/operandis/backups

echo "==> Backing up database"
mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump -Fc operandis > "$BACKUP_DIR/operandis-$(date +%Y%m%d-%H%M%S).dump"
ls -1t "$BACKUP_DIR"/operandis-*.dump | tail -n +15 | xargs -r rm --

echo "==> Fetching code"
sudo -u operandis git -C "$APP" fetch --quiet origin main
sudo -u operandis git -C "$APP" reset --hard origin/main

echo "==> Installing and building"
cd "$APP"
sudo -u operandis pnpm install --frozen-lockfile
sudo -u operandis env PORT=5173 BASE_PATH=/ pnpm build

echo "==> Migrating database"
sudo -u operandis bash -c "set -a; source $ENV_FILE; set +a; cd $APP/artifacts/api-server && node dist/migrate.mjs"

echo "==> Restarting"
systemctl restart operandis
sleep 3
curl -fsS http://127.0.0.1:8080/api/v1/ready && echo && echo "==> Deployed $(git -C "$APP" rev-parse --short HEAD)"
