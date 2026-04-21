#!/bin/bash
# 部署腳本:sync Notion → 有變動就 rebuild。由 systemd timer 每 5 分鐘呼叫一次。
# 沒變動時秒結束,不會打擾 Caddy 或 CPU。

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# 清舊 marker(避免殘留)
rm -f "$ROOT/.needs-build"

# 同步 Notion
pnpm sync

# 有 marker 才 rebuild
if [ -f "$ROOT/.needs-build" ]; then
    echo "[deploy] content changed, rebuilding..."
    pnpm build
    rm -f "$ROOT/.needs-build"
    echo "[deploy] rebuild complete."
else
    echo "[deploy] no changes."
fi
