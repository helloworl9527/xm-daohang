#!/bin/sh
set -eu

dump=${1:?usage: scripts/restore-smoke.sh BACKUP.dump ADMIN_PASSWORD_FILE}
password_file=${2:?usage: scripts/restore-smoke.sh BACKUP.dump ADMIN_PASSWORD_FILE}
[ -r "$dump" ] || { printf 'backup is not readable\n' >&2; exit 1; }
if [ "$(uname -s)" = "Darwin" ]; then
  password_mode=$(stat -f '%Lp' "$password_file")
else
  password_mode=$(stat -c '%a' "$password_file")
fi
[ "$password_mode" = "600" ] || {
  printf 'admin password file must have mode 0600\n' >&2
  exit 1
}

database="collection_restore_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() {
  docker compose exec -T postgres sh -eu -c \
    'dropdb --if-exists --force --username="$POSTGRES_USER" "$1"' -- "$database" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker compose exec -T postgres sh -eu -c \
  'createdb --username="$POSTGRES_USER" "$1"' -- "$database"
docker compose exec -T postgres sh -eu -c \
  'pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$1"' -- "$database" < "$dump"

absolute_password_file=$(cd "$(dirname "$password_file")" && pwd)/$(basename "$password_file")
docker compose run --rm \
  -e RESTORE_DATABASE_NAME="$database" \
  -e RESTORE_ADMIN_PASSWORD_FILE=/run/restore-admin-password \
  -v "$absolute_password_file:/run/restore-admin-password:ro" \
  app node --experimental-strip-types scripts/verify-restore.ts
