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
 *   { "<vmid>": { "status", "name", "type", "ip"?: "192.168.0.x", "dockge"?: true } }
 *   ip 只對 LXC 補:先讀 config net0 的靜態 ip,dhcp/抓不到且 running 時退而讀 runtime interfaces。
 *   dockge:實際探 ip:5001 有人聽才標 true — /homelab 的「Dockge Agents」清單只列這些,
 *   避免列出沒裝 Dockge 的 LXC(貼進 Dockge 也連不上)。在哪台裝了 agent 就自動冒出來。
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
import net from "node:net";
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

// 從 config 的 net0 字串(name=eth0,...,ip=192.168.0.232/24,type=veth)挖靜態 IP。
// dhcp / manual / 沒填 → 回 null(交給 runtime interfaces 退路)。
const parseStaticIp = (net0) => {
	if (!net0) return null;
	const m = net0.match(/(?:^|,)ip=([^,]+)/);
	if (!m) return null;
	const val = m[1];
	if (val === "dhcp" || val === "manual") return null;
	return val.split("/")[0];
};

// 每台 LXC 的 IP:先 config 靜態,失敗且 running 才讀 runtime interfaces。
// 全程 fail-soft — 任何錯誤回 null,該台就不顯示 agent 位址,不擋整包。
const fetchLxcIp = async (vmid, status) => {
	try {
		const cfg = await getJson(
			`${PVE_API_URL}/api2/json/nodes/${PVE_NODE}/lxc/${vmid}/config`,
		);
		const ip = parseStaticIp(cfg.data?.net0);
		if (ip) return ip;
	} catch {
		// 落到 runtime 退路
	}
	if (status === "running") {
		try {
			const ifs = await getJson(
				`${PVE_API_URL}/api2/json/nodes/${PVE_NODE}/lxc/${vmid}/interfaces`,
			);
			const eth = (ifs.data ?? []).find((i) => i.name !== "lo" && i.inet);
			if (eth?.inet) return eth.inet.split("/")[0];
		} catch {
			// 抓不到就算了
		}
	}
	return null;
};

// 探 host:port 有沒有人在聽(判斷該 LXC 是否真的跑 Dockge agent)。
// 短逾時、fail-soft:連不上 / 逾時 / 出錯一律當沒裝。
const DOCKGE_PORT = 5001;
const probePort = (host, port, timeoutMs = 1500) =>
	new Promise((resolve) => {
		const socket = new net.Socket();
		let settled = false;
		const finish = (open) => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(open);
		};
		socket.setTimeout(timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
		socket.connect(port, host);
	});

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

	// 補每台 LXC 的 IP + 探 :5001(平行,fail-soft)。給 /homelab 的 Dockge Agents 清單用:
	// 只有實際有 Dockge agent 在聽的才標 dockge=true。
	await Promise.all(
		lxc.map(async (ct) => {
			const ip = await fetchLxcIp(ct.vmid, ct.status);
			if (!ip) return;
			out[ct.vmid].ip = ip;
			if (ct.status === "running" && (await probePort(ip, DOCKGE_PORT))) {
				out[ct.vmid].dockge = true;
			}
		}),
	);

	await writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
	const running = Object.values(out).filter((v) => v.status === "running").length;
	console.log(`✨ sync-proxmox: ${Object.keys(out).length} 個 VM/CT(${running} running)`);
};

main().catch(async (e) => {
	await writeEmptyAndExit(`未預期錯誤:${e.message}`);
});
