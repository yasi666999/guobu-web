#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DUCKDNS_DOMAIN:-}" || -z "${DUCKDNS_TOKEN:-}" ]]; then
  cat <<'EOF'
请先设置环境变量：

  export DUCKDNS_DOMAIN=guobu-demo
  export DUCKDNS_TOKEN=你的DuckDNS令牌
  bash deploy/duckdns-setup.sh

脚本会立即更新子域名，并安装每 5 分钟自动更新公网 IP 的任务。
EOF
  exit 1
fi

if [[ "$DUCKDNS_DOMAIN" == *.* ]]; then
  echo "DUCKDNS_DOMAIN 只填写子域名，例如 guobu-demo，不要包含 .duckdns.org"
  exit 1
fi

UPDATE_URL="https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}&ip="
RESULT="$(curl -fsS "$UPDATE_URL")"
if [[ "$RESULT" != "OK" ]]; then
  echo "DuckDNS 更新失败：$RESULT"
  exit 1
fi

mkdir -p "$HOME/.config/guobu"
cat > "$HOME/.config/guobu/duckdns.env" <<EOF
DUCKDNS_DOMAIN=$DUCKDNS_DOMAIN
DUCKDNS_TOKEN=$DUCKDNS_TOKEN
EOF
chmod 600 "$HOME/.config/guobu/duckdns.env"

CRON_LINE="*/5 * * * * . $HOME/.config/guobu/duckdns.env; curl -fsS \"https://www.duckdns.org/update?domains=\$DUCKDNS_DOMAIN&token=\$DUCKDNS_TOKEN&ip=\" >/dev/null 2>&1"
(crontab -l 2>/dev/null | grep -v 'duckdns.org/update' || true; echo "$CRON_LINE") | crontab -

echo "DuckDNS 已更新：${DUCKDNS_DOMAIN}.duckdns.org"
