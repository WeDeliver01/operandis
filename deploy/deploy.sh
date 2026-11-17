#!/usr/bin/env bash
#
# Deploy Operandis on this host (web01), the same way AirHouse is deployed.
#
#   ./deploy/deploy.sh              # back up, build, migrate, switch to the new version
#   ./deploy/deploy.sh --status     # what is running now
#   ./deploy/deploy.sh --rollback   # go back to the previous image (migrations are additive)
#   ./deploy/deploy.sh --backup     # take a database backup only
#
# The new image is built first and the running container is only replaced once
# the build succeeded; the switch-over waits for the health check.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/deploy/.env.production"
PREVIOUS_TAG_FILE="$REPO_ROOT/deploy/.previous-release"
BACKUP_DIR="${BACKUP_DIR:-/srv/backups/operandis}"
DOMAIN="${DOMAIN:-operandis.co.za}"

cd "$REPO_ROOT"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m    %s\033[0m\n' "$*"; }
die()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

compose() { docker compose --env-file "$ENV_FILE" "$@"; }

# Parse KEY=value without letting the shell execute the file (values such as
# "Operandis <hello@operandis.co.za>" would otherwise break `source`).
load_env() {
  local line key value lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    [ "$lineno" -eq 1 ] && line="${line#$'\xef\xbb\xbf'}"
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in ""|\#*) continue ;; esac
    line="${line#export }"
    case "$line" in *=*) ;; *) die "$ENV_FILE line $lineno is not KEY=value: $line" ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in [A-Za-z_]*) ;; *) die "$ENV_FILE line $lineno has an invalid name: $key" ;; esac
    case "$key" in *[!A-Za-z0-9_]*) die "$ENV_FILE line $lineno has an invalid name: $key" ;; esac
    if [ ${#value} -ge 2 ]; then
      case "$value" in
        \"*\") value="${value:1:${#value}-2}" ;;
        \'*\') value="${value:1:${#value}-2}" ;;
      esac
    fi
    case "$line" in
      *\"*|*\'*) ;;
      *" #"*) die "$ENV_FILE line $lineno: put the comment for $key on its own line." ;;
    esac
    export "$key=$value"
  done < "$ENV_FILE"
}

backup() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  if docker ps --format '{{.Names}}' | grep -qx operandis-db; then
    local file
    file="$BACKUP_DIR/operandis-$(date -u +%Y%m%d-%H%M%S).dump"
    docker exec operandis-db pg_dump -U operandis -Fc operandis > "$file"
    echo "    $file ($(du -h "$file" | cut -f1))"
    ls -1t "$BACKUP_DIR"/operandis-*.dump 2>/dev/null | tail -n +31 | xargs -r rm --
  else
    warn "Database container not running yet; nothing to back up (first deploy)."
  fi
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy deploy/.env.production.example and fill it in."
if [ "$(stat -c '%a' "$ENV_FILE")" != "600" ]; then
  warn "Tightening $ENV_FILE to mode 600 (it holds secrets)."
  chmod 600 "$ENV_FILE"
fi
command -v docker >/dev/null 2>&1 || die "docker is not installed."
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed."

load_env
missing=""
for key in PUBLIC_WEB_URL APP_PORT POSTGRES_PASSWORD APP_SECRET SMTP_HOST EMAIL_FROM; do
  [ -z "${!key:-}" ] && missing="$missing $key"
done
[ -n "$missing" ] && die "Missing required settings in $ENV_FILE:$missing"
[ "${#APP_SECRET}" -ge 32 ] || die "APP_SECRET must be at least 32 characters (openssl rand -base64 48)."

case "${1:-deploy}" in
  --status)
    log "Containers"
    compose ps
    log "Health"
    curl -fsS "http://127.0.0.1:${APP_PORT}/api/v1/ready" && echo
    exit 0
    ;;
  --backup)
    log "Backing up the database"
    backup
    exit 0
    ;;
  --rollback)
    [ -f "$PREVIOUS_TAG_FILE" ] || die "No previous release recorded; nothing to roll back to."
    previous="$(cat "$PREVIOUS_TAG_FILE")"
    log "Rolling back to $previous"
    RELEASE="$previous" compose up -d --no-build app
    log "Rolled back. Verify with: $0 --status"
    exit 0
    ;;
  deploy) ;;
  *) die "Unknown option: $1" ;;
esac

# The host port must be free (or already ours) — web01 runs other apps.
if ! command -v ss >/dev/null 2>&1; then
  warn "ss not found; skipping the free-port check."
elif ss -ltn "sport = :${APP_PORT}" | grep -q LISTEN; then
  owner="$(docker ps --filter "publish=${APP_PORT}" --format '{{.Names}}' | head -1)"
  [ "$owner" = "operandis" ] || die "Port ${APP_PORT} is already used by another service${owner:+ ($owner)}. Pick a free APP_PORT and update proxy_pass in the nginx site."
fi

RELEASE="$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)"
export RELEASE
log "Deploying release $RELEASE"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "Uncommitted changes in the working tree will be included in this build."
fi

current="$(docker inspect --format '{{ index .Config.Labels "release" }}' operandis 2>/dev/null || true)"
if [ -n "$current" ] && [ "$current" != "$RELEASE" ]; then
  echo "$current" > "$PREVIOUS_TAG_FILE"
fi

log "Building the image (the running site is untouched until this succeeds)"
compose build app

log "Starting the database"
compose up -d --wait db

log "Backing up the database"
backup

log "Applying migrations"
compose run --rm --no-deps app node dist/migrate.mjs

log "Starting the new version"
compose up -d app

log "Waiting for it to report healthy"
deadline=$(( $(date +%s) + 120 ))
healthy=false
while [ "$(date +%s)" -lt "$deadline" ]; do
  state="$(docker inspect --format '{{ .State.Health.Status }}' operandis 2>/dev/null || echo starting)"
  if [ "$state" = "healthy" ]; then healthy=true; break; fi
  if [ "$state" = "unhealthy" ]; then break; fi
  sleep 3
done
if [ "$healthy" != true ]; then
  warn "The new container did not become healthy. Recent logs:"
  compose logs --tail 60 app || true
  die "Deploy failed. Roll back with: $0 --rollback"
fi

log "Verifying through nginx"
if curl -fsS --max-time 10 "https://${DOMAIN}/api/v1/health" >/dev/null 2>&1; then
  echo "    https://${DOMAIN}/api/v1/health responded"
else
  warn "Could not reach https://${DOMAIN}/api/v1/health."
  warn "The container is healthy, so this is usually nginx, DNS or the certificate:"
  warn "  sudo nginx -t && sudo systemctl reload nginx"
fi

log "Cleaning up old images"
docker image prune -f --filter "label=app=operandis" >/dev/null 2>&1 || true

log "Deployed $RELEASE"
echo "    Roll back with: $0 --rollback"
echo "    Logs:           docker logs -f operandis"
