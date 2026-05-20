#!/usr/bin/env node
/**
 * sync-proxmox.mjs — 從 Proxmox API 抓 LXC + QEMU status 快照
 *
 * 需要環境變數(放 .env.local):
 *   PVE_API_URL    — 例 https://192.168.0.168:8006
 *   PVE_API_TOKEN  — 格式 USER@REALM!TOKENID=UUID(整段,不要拆)
 *   PVE_NODE       — 例 pve
 *
 * 輸出:src/data/services.generated.json
 *   { "<vmid>": { "status": "running" | "stopped", "name": "...", "type": "lxc" | "qemu" } }
 *
 * 設計原則:fail-soft。任何一步失敗都 log warning + 寫空物件(讓頁面 fallback 顯示
 * "unknown"),deploy.sh 不該因為 Proxmox 連不上就整個 build 失敗。
 *
 * 自簽 cert:內網 Proxmox 用 self-signed cert,fetch 要關 cert 驗證。
 */

import { writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "src", "data", "services.generated.json");

const { PVE_API_URL, PVE_API_TOKEN, PVE_NODE } = process.env;

const writeEmptyAndExit = async (reason) => {
	console.warn(`⚠️  sync-proxmox: ${reason}`);
	console.warn("    寫入空快照,頁面會 fallback 顯示 unknown。");
	await writeFile(OUTPUT_PATH, JSON.stringify({}, null, 2) + "\n", "utf-8");
	process.exit(0);
};

if (!PVE_API_URL || !PVE_API_TOKEN || !PVE_NODE) {
	await writeEmptyAndExit("缺少 PVE_API_URL / PVE_API_TOKEN / PVE_NODE 環境變數");
}

// 內網自簽 cert,關掉驗證
const agent = new https.Agent({ rejectUnauthorized: false });

const fetchPveList = async (kind) => {
	const url = `${PVE_API_URL}/api2/json/nodes/${PVE_NODE}/${kind}`;
	const res = await fetch(url, {
		headers: { Authorization: `PVEAPIToken=${PVE_API_TOKEN}` },
		// @ts-ignore — Node fetch 接受 dispatcher/agent
		dispatcher: agent,
		// 老的 node 版本走 https.Agent;新版會用 dispatcher。兩者擇一生效不影響功能。
		agent,
	});
	if (!res.ok) {
		throw new Error(`Proxmox API ${kind} 回 ${res.status}: ${await res.text()}`);
	}
	const json = await res.json();
	return json.data ?? [];
};

const main = async () => {
	let lxc = [];
	let qemu = [];
	try {
		[lxc, qemu] = await Promise.all([fetchPveList("lxc"), fetchPveList("qemu")]);
	} catch (e) {
		await writeEmptyAndExit(`Proxmox API 失敗:${e.message}`);
	}

	const out = {};
	for (const ct of lxc) {
		out[ct.vmid] = { status: ct.status, name: ct.name, type: "lxc" };
	}
	for (const vm of qemu) {
		out[vm.vmid] = { status: vm.status, name: vm.name, type: "qemu" };
	}

	await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
	const running = Object.values(out).filter((v) => v.status === "running").length;
	console.log(`✨ sync-proxmox: ${Object.keys(out).length} 個 VM/CT(${running} running)`);
};

main().catch(async (e) => {
	await writeEmptyAndExit(`未預期錯誤:${e.message}`);
});
