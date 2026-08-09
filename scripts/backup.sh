#!/bin/sh
set -eu
umask 077

output_directory=${1:-./backups}
mkdir -p "$output_directory"
chmod 700 "$output_directory"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
output="$output_directory/collection-system-$timestamp.dump"

docker compose exec -T postgres sh -eu -c \
  'pg_dump --format=custom --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$output"
chmod 600 "$output"
printf '%s\n' "$output"
