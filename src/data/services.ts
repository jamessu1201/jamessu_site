// Proxmox / Homelab 服務清單。手寫維護,vmid 對應 Proxmox 上的 VMID,
// 用來和 sync-proxmox.mjs 抓回來的 status 快照合併。
// 沒填 vmid 的條目(例如 Proxmox host 本身)頁面會顯示「-」狀態。

export type ServiceCategory =
	| "infrastructure"
	| "monitoring"
	| "productivity"
	| "media";

export interface Service {
	name: string;
	category: ServiceCategory;
	url: string;
	vmid?: number;
	icon: string;
	description: string;
}

export const categoryLabels: Record<ServiceCategory, { zh: string; en: string }> = {
	infrastructure: { zh: "基礎設施", en: "Infrastructure" },
	monitoring: { zh: "監控", en: "Monitoring" },
	productivity: { zh: "生產力", en: "Productivity" },
	media: { zh: "媒體", en: "Media" },
};

export const categoryOrder: ServiceCategory[] = [
	"infrastructure",
	"monitoring",
	"productivity",
	"media",
];

export const services: Service[] = [
	// ---------- Infrastructure ----------
	{
		name: "Proxmox VE",
		category: "infrastructure",
		url: "https://192.168.0.168:8006",
		icon: "fa6-solid:server",
		description: "Hypervisor / Proxmox web UI",
	},
	{
		name: "Tailscale Subnet Router",
		category: "infrastructure",
		url: "https://login.tailscale.com/admin/machines",
		vmid: 102,
		icon: "fa6-solid:network-wired",
		description: "LXC 102 · advertise 192.168.0.0/24",
	},
	{
		name: "jamessu_site",
		category: "infrastructure",
		url: "https://jamessu1201.com",
		vmid: 100,
		icon: "fa6-solid:globe",
		description: "LXC 100 · Astro 靜態站 + Caddy + Cloudflare Tunnel",
	},
	{
		name: "Dockge",
		category: "infrastructure",
		url: "http://192.168.0.232:5001",
		vmid: 103,
		icon: "fa6-solid:layer-group",
		description: "LXC 103 · compose 中央管理 (hub + agents on 101/104/105/106)",
	},
	{
		name: "Home Assistant",
		category: "infrastructure",
		url: "http://192.168.0.236:8123",
		vmid: 107,
		icon: "fa6-solid:house-signal",
		description: "LXC 107 · 智慧家庭 / room-presence 存在感測",
	},

	// ---------- Monitoring ----------
	{
		name: "Grafana",
		category: "monitoring",
		url: "http://192.168.0.232:3000",
		vmid: 103,
		icon: "fa6-solid:chart-line",
		description: "LXC 103 · Proxmox metrics 視覺化",
	},
	{
		name: "InfluxDB",
		category: "monitoring",
		url: "http://192.168.0.232:8086",
		vmid: 103,
		icon: "fa6-solid:database",
		description: "LXC 103 · org homelab / bucket proxmox",
	},

	// ---------- Productivity ----------
	{
		name: "Vaultwarden",
		category: "productivity",
		url: "https://vaultwarden.tailad56e3.ts.net",
		vmid: 101,
		icon: "fa6-solid:key",
		description: "LXC 101 · 密碼管理 + passkey",
	},
	{
		name: "Stirling-PDF",
		category: "productivity",
		url: "http://192.168.0.233:8080",
		vmid: 104,
		icon: "fa6-solid:file-pdf",
		description: "LXC 104 · 50+ PDF 工具",
	},

	// ---------- Media ----------
	{
		name: "YTPTube",
		category: "media",
		url: "http://192.168.0.234:8081",
		vmid: 105,
		icon: "fa6-brands:youtube",
		description: "LXC 105 · YouTube 下載 (MeTube fork)",
	},
	{
		name: "Cobalt API",
		category: "media",
		url: "http://192.168.0.234:9000",
		vmid: 105,
		icon: "fa6-solid:cloud-arrow-down",
		description: "LXC 105 · IG/X/TikTok 等 22 平台下載 API",
	},
	{
		name: "Jellyfin",
		category: "media",
		url: "http://192.168.0.239:8096",
		vmid: 110,
		icon: "fa6-solid:film",
		description: "LXC 110 · 自架影音串流 (含 rmvb 即時轉檔)",
	},
];
