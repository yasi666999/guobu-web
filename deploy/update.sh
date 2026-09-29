#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/guobu-web}"

if [[ "$EUID" -ne 0 ]]; then
  echo "请使用 root 权限运行，例如：sudo bash deploy/update.sh"
  exit 1
fi

cd "$APP_DIR"
git pull --ff-only
docker compose --env-file deploy/.env -f deploy/docker-compose.yml pull
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d
docker image prune -f

echo "更新完成。"
