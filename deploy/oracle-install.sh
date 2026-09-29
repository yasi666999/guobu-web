#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-}"
REPO_URL="${REPO_URL:-https://github.com/yasi666999/guobu-web.git}"
APP_DIR="${APP_DIR:-/opt/guobu-web}"

if [[ -z "$DOMAIN" ]]; then
  echo "用法：sudo bash deploy/oracle-install.sh <你的免费域名>"
  echo "示例：sudo bash deploy/oracle-install.sh guobu-demo.duckdns.org"
  exit 1
fi

if [[ "$EUID" -ne 0 ]]; then
  echo "请使用 root 权限运行，例如：sudo bash deploy/oracle-install.sh $DOMAIN"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  apt-get update
  apt-get install -y curl ca-certificates git
fi

if ! command -v git >/dev/null 2>&1; then
  apt-get update
  apt-get install -y git
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "正在安装 Docker..."
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "当前 Docker 不包含 Compose 插件，请先安装 docker-compose-plugin。"
  exit 1
fi

if [[ -d "$APP_DIR/.git" ]]; then
  echo "更新项目：$APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  echo "下载项目到：$APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [[ ! -f deploy/.env ]]; then
  cp deploy/.env.production.example deploy/.env
fi

if grep -q '^DOMAIN=' deploy/.env; then
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" deploy/.env
else
  echo "DOMAIN=$DOMAIN" >> deploy/.env
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

echo "拉取或构建应用镜像..."
if ! docker compose --env-file deploy/.env -f deploy/docker-compose.yml pull; then
  docker compose --env-file deploy/.env -f deploy/docker-compose.yml build
fi

docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d

cat > /etc/cron.d/guobu-backup <<EOF
0 3 * * * root cd $APP_DIR && docker compose -f deploy/docker-compose.yml exec -T app node scripts/backup_db.js >> /var/log/guobu-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/guobu-backup

echo
echo "部署完成。"
echo "网站：https://$DOMAIN"
echo "健康检查：https://$DOMAIN/api/health"
echo "查看状态：cd $APP_DIR && docker compose -f deploy/docker-compose.yml ps"
echo "查看日志：cd $APP_DIR && docker compose -f deploy/docker-compose.yml logs -f app caddy"
