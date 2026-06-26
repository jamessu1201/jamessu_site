#!/bin/bash
# 部署腳本:sync Notion → 有變動就 rebuild。由 systemd timer 每 5 分鐘呼叫一次。
# 沒變動時秒結束,不會打擾 Caddy 或 CPU。

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# 清舊 marker(避免殘留)
rm -f "$ROOT/.needs-build"

# ---- Pull-based CD:跟 GitHub 同步 ----
# 部署機完全鏡像 origin/main(reset --hard 不被本地飄移卡住)。push 到 GitHub 後,
# 下一次 timer(≤5 分鐘)就會自動拉下來 rebuild,不用手動 git pull。
# 注意:此腳本可能在 reset 時被自己更新 — 影響僅限這一次,下一次 run 跑的就是新版,自癒。
# git 失敗(GitHub 暫掛/網路)不擋部署:沿用現有程式碼繼續往下跑。
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    if git -C "$ROOT" fetch --quiet origin main; then
        REMOTE="$(git -C "$ROOT" rev-parse origin/main)"
        LOCAL="$(git -C "$ROOT" rev-parse HEAD)"
        if [ "$LOCAL" != "$REMOTE" ]; then
            echo "[deploy] 偵測到新 commit $REMOTE,同步 origin/main..."
            git -C "$ROOT" reset --hard "$REMOTE"
        fi
    else
        echo "[deploy] git fetch 失敗,沿用現有版本。"
    fi
fi

# 同步 Notion
pnpm sync

# 抓 Proxmox status 快照 (fail-soft,腳本內部會自己處理錯誤寫空 JSON,不會非 0 exit)。
# 每跑一次就標記要 rebuild,讓 status 變化能反映到頁面 (5 分鐘延遲可接受)。
pnpm sync:proxmox
touch "$ROOT/.needs-build"

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
