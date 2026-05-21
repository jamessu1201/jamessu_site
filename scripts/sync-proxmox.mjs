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
 * 設計原則:fail-soft。任何一步失敗都 log warning + 寫空物件,不擋 build。
 *
 * 為什麼用 node:https 不用 fetch:內網 Proxmox 是自簽 cert。Node 內建 fetch (undici)
 * 的 cert 繞過選項要靠 undici Dispatcher,而 undici 不是專案的直接 dep。用 https.get
 * + rejectUnauthorized:false 一行搞定,且 cause/stack 比 fetch 的 "fetch failed"
 * 通用訊息有用得多。
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

const getJson = (url) =>
	new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{
				headers: { Authorization: `PVEAPIToken=${PVE_API_TOKEN}` },
				rejectUnauthorized: false, // 內網自簽 cert
			},
			(res) => {
				let body = "";
				res.setEncoding("utf-8");
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
						reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch (e) {
						reject(new Error(`JSON parse failed: ${e.message} (body: ${body.slice(0, 200)})`));
					}
				});
			},
		);
		req.on("error", reject);
		req.setTimeout(10000, () => {
			req.destroy(new Error("request timeout (10s)"));
		});
	});

const fetchPveList = async (kind) => {
	const url = `${PVE_API_URL}/api2/json/nodes/${PVE_NODE}/${kind}`;
	const json = await getJson(url);
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
