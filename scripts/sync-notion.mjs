#!/usr/bin/env node
/**
 * sync-notion.mjs — 把 Notion database 的「已發布」文章同步成 Fuwari markdown 檔
 *
 * 需要環境變數:
 *   NOTION_TOKEN         — Notion integration token
 *   NOTION_DATABASE_ID   — 文章 database 的 ID(URL 中的 32 字元那段)
 *
 * 做的事:
 *   1. 抓 DB 裡 Status = Published 的所有頁面
 *   2. 下載 cover + inline 圖片到 public/images/notion/<slug>/
 *   3. 轉 Notion blocks → markdown,重寫圖片 URL 為本地路徑
 *   4. 寫 src/content/posts/<slug>.md(含 frontmatter)
 *   5. 刪掉自己以前同步過但 Notion 已不再 Published 的檔案
 */

import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const POSTS_DIR = path.join(ROOT, "src", "content", "posts");
const IMAGES_ROOT = path.join(ROOT, "public", "images", "notion");

const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
    console.error("❌ 缺少環境變數 NOTION_TOKEN 或 NOTION_DATABASE_ID");
    console.error("   複製 .env.example → .env.local,填入你的值");
    process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const n2m = new NotionToMarkdown({ notionClient: notion });

// Frontmatter 裡加這個 marker,sync 只管有這個 marker 的檔案
const SOURCE_MARKER = "notion";

// ---------- helpers ----------

const propText = (prop) => {
    if (!prop) return "";
    if (prop.type === "title") return prop.title.map((t) => t.plain_text).join("");
    if (prop.type === "rich_text") return prop.rich_text.map((t) => t.plain_text).join("");
    if (prop.type === "select") return prop.select?.name ?? "";
    if (prop.type === "multi_select") return prop.multi_select.map((s) => s.name);
    if (prop.type === "date") return prop.date?.start ?? "";
    if (prop.type === "checkbox") return prop.checkbox;
    return "";
};

const escapeYaml = (s) => s.replace(/"/g, '\\"');

const buildFrontmatter = ({ title, published, description, tags, category, image, notionEdited }) => {
    const lines = [
        "---",
        `source: ${SOURCE_MARKER}`,
        `notion_edited: ${notionEdited}`,
        `title: "${escapeYaml(title)}"`,
        `published: ${published}`,
    ];
    if (description) lines.push(`description: "${escapeYaml(description)}"`);
    if (image) lines.push(`image: "${image}"`);
    if (tags && tags.length) lines.push(`tags: [${tags.map((t) => `"${escapeYaml(t)}"`).join(", ")}]`);
    if (category) lines.push(`category: "${escapeYaml(category)}"`);
    lines.push("---");
    return lines.join("\n");
};

// 讀已存在檔案的 frontmatter,回傳 { source, notionEdited }
const getExistingMeta = async (postPath) => {
    try {
        const content = await readFile(postPath, "utf-8");
        const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1];
        if (!fm) return null;
        return {
            source: fm.match(/^source:\s*(.+)$/m)?.[1]?.trim(),
            notionEdited: fm.match(/^notion_edited:\s*(.+)$/m)?.[1]?.trim(),
        };
    } catch {
        return null;
    }
};

const fileExistsNonEmpty = async (p) => {
    try {
        const s = await stat(p);
        return s.isFile() && s.size > 0;
    } catch {
        return false;
    }
};

const downloadImage = (url, dest) =>
    new Promise((resolve, reject) => {
        const file = createWriteStream(dest);
        https
            .get(url, (res) => {
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    // follow redirect once
                    https.get(res.headers.location, (res2) => {
                        res2.pipe(file);
                        file.on("finish", () => file.close(resolve));
                    }).on("error", reject);
                    return;
                }
                res.pipe(file);
                file.on("finish", () => file.close(resolve));
            })
            .on("error", reject);
    });

const extFromUrl = (url) => {
    const m = url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i);
    return m ? `.${m[1].toLowerCase()}` : ".jpg";
};

// Notion 會在段落和 list 前加 4+ 空白(中文排版首行縮排),markdown 會誤當 code block。
// 處理方式:段落一律左切齊;list 用「序列中第一項的縮排」當基準,後續相對它縮排(保留巢狀)。
const normalizeMarkdown = (md) => {
    const lines = md.split("\n");
    let inFence = false;
    let listBaseIndent = null; // 當前 list 序列的基準縮排長度
    const out = [];
    for (const line of lines) {
        if (line.trim().startsWith("```")) {
            inFence = !inFence;
            out.push(line);
            listBaseIndent = null;
            continue;
        }
        if (inFence) {
            out.push(line);
            continue;
        }
        if (line.trim() === "") {
            out.push(line);
            continue; // 空行不中斷 list 序列
        }
        const leading = line.match(/^(\s*)/)[0];
        const content = line.slice(leading.length);
        const isListItem = /^([-*+]|\d+\.)\s/.test(content);
        if (!isListItem) {
            out.push(content); // 段落:前導空白砍掉
            listBaseIndent = null;
            continue;
        }
        if (listBaseIndent === null) {
            listBaseIndent = leading.length;
            out.push(content); // 序列第一項:去掉基準縮排
        } else {
            const relative = Math.max(0, leading.length - listBaseIndent);
            out.push(" ".repeat(relative) + content);
        }
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
};

// ---------- main ----------

const fetchAllPages = async () => {
    const pages = [];
    let cursor;
    do {
        const res = await notion.databases.query({
            database_id: NOTION_DATABASE_ID,
            start_cursor: cursor,
            filter: { property: "Status", select: { equals: "Published" } },
            page_size: 100,
        });
        pages.push(...res.results);
        cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    return pages;
};

const processPage = async (page, stats) => {
    const props = page.properties;
    const title = propText(props.Name) || propText(props.Title) || "Untitled";
    const slug = propText(props.Slug);
    if (!slug) {
        console.warn(`⚠️  略過「${title}」— 沒填 Slug`);
        return null;
    }

    const postPath = path.join(POSTS_DIR, `${slug}.md`);
    const notionEdited = page.last_edited_time;

    // 增量同步:檔案存在且 notion_edited 沒變 → 略過整篇
    const existing = await getExistingMeta(postPath);
    if (existing?.source === SOURCE_MARKER && existing.notionEdited === notionEdited) {
        stats.skipped++;
        return slug;
    }

    const published = propText(props.Published) || new Date(page.created_time).toISOString().slice(0, 10);
    const description = propText(props.Description);
    const tags = propText(props.Tags);
    const category = propText(props.Category);

    const imageDir = path.join(IMAGES_ROOT, slug);
    await mkdir(imageDir, { recursive: true });

    // cover
    let coverPath = "";
    const coverUrl = page.cover?.external?.url || page.cover?.file?.url;
    if (coverUrl) {
        const ext = extFromUrl(coverUrl);
        const dest = path.join(imageDir, `cover${ext}`);
        if (await fileExistsNonEmpty(dest)) {
            coverPath = `/images/notion/${slug}/cover${ext}`;
        } else {
            try {
                await downloadImage(coverUrl, dest);
                coverPath = `/images/notion/${slug}/cover${ext}`;
            } catch (e) {
                console.warn(`  ⚠️  cover 下載失敗 (${title}):`, e.message);
            }
        }
    }

    // content
    const mdBlocks = await n2m.pageToMarkdown(page.id);
    let md = n2m.toMarkdownString(mdBlocks).parent || "";

    // rewrite inline image URLs to local files
    let imgIndex = 0;
    const imagePromises = [];
    md = md.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_, alt, url) => {
        const ext = extFromUrl(url);
        const filename = `img-${++imgIndex}${ext}`;
        const dest = path.join(imageDir, filename);
        imagePromises.push(
            (async () => {
                if (await fileExistsNonEmpty(dest)) return;
                try {
                    await downloadImage(url, dest);
                } catch (e) {
                    console.warn(`  ⚠️  image 下載失敗:`, e.message);
                }
            })(),
        );
        return `![${alt}](/images/notion/${slug}/${filename})`;
    });
    await Promise.all(imagePromises);

    const frontmatter = buildFrontmatter({
        title,
        published,
        description,
        tags: Array.isArray(tags) ? tags : [],
        category,
        image: coverPath,
        notionEdited,
    });

    const body = `${frontmatter}\n\n${normalizeMarkdown(md).trim()}\n`;
    await writeFile(postPath, body, "utf-8");
    const verb = existing ? "🔄 更新" : "✅ 新增";
    console.log(`${verb} ${slug}.md ← ${title}`);
    if (existing) stats.updated++;
    else stats.created++;
    return slug;
};

const cleanupOrphans = async (syncedSlugs, stats) => {
    const existing = await readdir(POSTS_DIR).catch(() => []);
    for (const file of existing) {
        if (!file.endsWith(".md")) continue;
        const slug = file.replace(/\.md$/, "");
        const full = path.join(POSTS_DIR, file);
        const content = await readFile(full, "utf-8").catch(() => "");
        if (!content.includes(`source: ${SOURCE_MARKER}`)) continue; // 手寫檔不動
        if (syncedSlugs.has(slug)) continue;
        await rm(full);
        await rm(path.join(IMAGES_ROOT, slug), { recursive: true, force: true });
        console.log(`🗑  移除 ${file}(Notion 已撤下)`);
        stats.removed++;
    }
};

const main = async () => {
    await mkdir(POSTS_DIR, { recursive: true });
    await mkdir(IMAGES_ROOT, { recursive: true });

    const pages = await fetchAllPages();
    const stats = { created: 0, updated: 0, skipped: 0, removed: 0 };

    const syncedSlugs = new Set();
    for (const page of pages) {
        try {
            const slug = await processPage(page, stats);
            if (slug) syncedSlugs.add(slug);
        } catch (e) {
            console.error(`❌ 處理失敗:`, e.message);
        }
    }

    await cleanupOrphans(syncedSlugs, stats);

    const changed = stats.created + stats.updated + stats.removed > 0;
    if (changed) {
        console.log(
            `✨ 新增 ${stats.created} / 更新 ${stats.updated} / 未變動 ${stats.skipped} / 移除 ${stats.removed}`,
        );
        // 放 marker file,讓 deploy script 知道要 rebuild
        await writeFile(path.join(ROOT, ".needs-build"), new Date().toISOString(), "utf-8");
    } else if (stats.skipped > 0) {
        console.log(`💤 沒有變動(${stats.skipped} 篇已是最新)`);
    } else {
        console.log(`💤 Notion 沒有 Published 文章`);
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
