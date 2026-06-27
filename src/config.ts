import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "蘇靖淵 | Ching-Yuan Su",
	subtitle: "NYCU PAIRLabs · Graduate Student",
	lang: "zh_TW",
	themeColor: {
		hue: 210,
		fixed: false,
	},
	banner: {
		enable: false,
		src: "",
		position: "center",
		credit: {
			enable: false,
			text: "",
			url: "",
		},
	},
	toc: {
		enable: true,
		depth: 2,
	},
	favicon: [],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		LinkPreset.About,
		{
			name: "Resume",
			url: "/resume/",
		},
		{
			name: "Homelab",
			url: "/homelab/",
			// 內容只在 Tailscale 內網(CF 會把 /homelab/ 302 到 http://192.168.0.227/),
			// 用新分頁開啟,避免離開公網域名後卡在內網 IP 回不去 + 避開 Swup 跨網域轉場
			external: true,
		},
		{
			name: "Tools",
			url: "/tools/hash/",
		},
		{
			name: "GitHub",
			url: "https://github.com/jamessu1201",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "assets/images/head.jpg",
	name: "蘇靖淵 / Ching-Yuan Su",
	bio: "NYCU 智能系統研究所碩士生 @ PAIRLabs。",
	links: [
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/jamessu1201",
		},
		{
			name: "Email",
			icon: "fa6-solid:envelope",
			url: "mailto:joan3825ms55@gmail.com",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};
