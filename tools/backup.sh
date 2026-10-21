#!/bin/sh
# Backup of a Docker Compose installation: the database and the uploaded files.
#
#   tools/backup.sh [directory]     default: ~/ts-backups/<date-time>
#
# The backup holds personal data, password hashes and encrypted credentials, so it
# is written readable by the owner only (umask 077) and never into this checkout,
# where `git add -A` could commit it. Run it from anywhere; it uses the compose
# project of this checkout.
set -eu
umask 077

repo=$(cd "$(dirname "$0")/.." && pwd)
target=${1:-"$HOME/ts-backups/$(date +%Y%m%d-%H%M%S)"}
mkdir -p "$target"
target=$(cd "$target" && pwd)
case "$target/" in
  "$repo"/*)
    echo "Refusing to write a backup inside the checkout ($repo). Pick a directory outside it." >&2
    rmdir "$target" 2>/dev/null || true
    exit 1
    ;;
esac

cd "$repo"
docker compose exec -T mongo sh -c \
  'mongodump -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db meteor --archive' \
  > "$target/backup.archive"
docker compose exec -T ts_core tar czf - -C /app.storage/files . > "$target/ts-files.tar.gz"
echo "Backup written to $target"
