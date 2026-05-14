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
    # 清掉舊 dist + Astro 5 的 content layer cache。
    # data-store.json 不會在來源 .md 被刪除時自動 invalidate,
    # 結果是已下架文章還是會被 [...slug].astro 重新生成。
    rm -rf "$ROOT/dist" "$ROOT/node_modules/.astro"
    pnpm build
    rm -f "$ROOT/.needs-build"
    echo "[deploy] rebuild complete."
else
    echo "[deploy] no changes."
fi
