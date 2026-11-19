#!/usr/bin/env node
/**
 * extract-data.mjs —— 源 HTML → Astro 多文件多条目 JSON 数据集（v2.2，Node 原生零依赖）
 *
 * 用法：node scripts/extract-data.mjs <源HTML路径> [内容根目录，默认 src/content]
 *
 * v2.2 输出格式（每分类一个文件，文件内为条目数组）：
 *   src/content/boards.json                              板块与分类唯一定义文件（categories 含 itemCount）
 *   src/content/games/{boardSlug}/{categorySlug}.json    条目数组，每条为扁平对象 {name, desc, url, tags}
 * id/board/category 不落盘——由构建时 loader 从文件路径与数组顺序推导（层级 id b{n}-c{m}-{k}）。
 * 输出前清空生成目标（games 目录 + boards.json），脚本幂等。
 *
 * 解析与校验规则（与 v1/v2 一致）：
 * 1. 以 <h2 id="sN"> 切分 7 大板块；s1（11 篇公众号原文）按用户决策跳过；
 * 2. 板块内按 <h3> 切分类；s3/s4/s7 无 h3，回退为单个伪分类（名称=板块名）；
 * 3. 清洗：HTML 实体解码、剥内联标签、压缩空白、URL 仅保留 http(s)；
 * 4. h3 括号内数字作为条目数校验值（不一致仅警告）；
 * 5. 总条目数应为 257（源 268 − s1 的 11 条，已人工核对），不符则 exit 1。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/* ---------------------------------- 常量 ---------------------------------- */

/** 跳过不呈现的板块（用户决策：板块一 11 篇原文不进网站） */
const SKIP_SECTIONS = new Set(['s1']);

/** 板块图标（Lucide 图标名，按呈现顺序 b1..b6） */
const BOARD_ICONS = ['gamepad-2', 'hammer', 'box', 'smartphone', 'palette', 'key-round'];

/** 板块色（引用 main.css 的 --og-board-* 变量，视觉与 v1 一致） */
const BOARD_COLORS = [
  'var(--og-board-b1)',
  'var(--og-board-b2)',
  'var(--og-board-b3)',
  'var(--og-board-b4)',
  'var(--og-board-b5)',
  'var(--og-board-b6)'
];

/** 条目数据文件名（按源板块 s2..s7 顺序对应 b1..b6，作为初始导入批次） */
const BOARD_FILES = [
  's2-开源游戏.json',
  's3-引擎框架.json',
  's4-threejs.json',
  's5-微信小游戏.json',
  's6-美术工具.json',
  's7-商业源码.json'
];

/** 期望总条目数：以源 HTML 实际解析为准（s2..s7 共 257 条，已人工核对） */
const EXPECTED_TOTAL = 257;

/** HTML 实体解码映射 */
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  times: '×',
  divide: '÷'
};

/* --------------------------------- 工具函数 -------------------------------- */

/** 解码命名与数字 HTML 实体 */
function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body.toLowerCase()) ? ENTITIES[body.toLowerCase()] : m;
  });
}

/** 剥除全部内联 HTML 标签 */
function stripTags(text) {
  return String(text).replace(/<[^>]*>/g, '');
}

/** 清洗文本：剥标签 → 实体解码 → 压缩空白 */
function cleanText(text) {
  return stripTags(decodeEntities(text)).replace(/\s+/g, ' ').trim();
}

/** 移除分类标题尾部用于计数的全角括号数字 */
function stripCountParens(name) {
  return name.replace(/（\d+）\s*$/, '').trim();
}

/** 提取分类标题中最后一个全角括号数字作为期望条目数；无则返回 null */
function extractExpectedCount(name) {
  const counts = [...String(name).matchAll(/（(\d+)）/g)];
  return counts.length ? parseInt(counts[counts.length - 1][1], 10) : null;
}

function writeJson(filePath, data) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/* --------------------------------- 主流程 ---------------------------------- */

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('用法: node scripts/extract-data.mjs <源HTML路径> [内容根目录=src/content]');
  process.exit(1);
}
const srcPath = resolve(args[0]);
const contentRoot = resolve(args[1] || 'src/content');

let html;
try {
  html = readFileSync(srcPath, 'utf8');
} catch (err) {
  console.error(`[extract] 无法读取源文件: ${srcPath}\n${err.message}`);
  process.exit(1);
}

/* 0. 清空生成目标，保证幂等（含清理 v2.0 遗留的 boards/categories 目录） */
rmSync(join(contentRoot, 'games'), { recursive: true, force: true });
rmSync(join(contentRoot, 'boards.json'), { force: true });
rmSync(join(contentRoot, 'boards'), { recursive: true, force: true });
rmSync(join(contentRoot, 'categories'), { recursive: true, force: true });

/* 1. 按 <h2 id="sN"> 切分板块 */
const h2Re = /<h2 id="(s\d)"[^>]*>([\s\S]*?)<\/h2>/g;
const h2Matches = [...html.matchAll(h2Re)];
if (h2Matches.length === 0) {
  console.error('[extract] 未找到任何 <h2 id="sN"> 板块锚点，源文件格式可能已变化');
  process.exit(1);
}

const boards = [];
const warnings = [];
let boardIndex = 0;
let totalItems = 0;

h2Matches.forEach((m, i) => {
  const sectionId = m[1];
  const segStart = m.index + m[0].length;
  const segEnd = i + 1 < h2Matches.length ? h2Matches[i + 1].index : html.length;
  const segment = html.slice(segStart, segEnd);

  if (SKIP_SECTIONS.has(sectionId)) {
    console.log(`[extract] 跳过板块 ${sectionId}（用户决策：不呈现）`);
    return;
  }

  /* 2. 板块元信息：标题去掉序号前缀与尾部说明性括号 */
  const rawTitle = cleanText(m[2]);
  const boardName = rawTitle
    .replace(/^[一二三四五六七八九十百]+、\s*/, '')
    .replace(/（[^）]*）\s*$/, '')
    .trim();
  boardIndex += 1;
  const boardSlug = `b${boardIndex}`;

  /* 3. 段内按 <h3> 切分类；无 h3 时整段作为单个伪分类 */
  const h3Re = /<h3[^>]*>([\s\S]*?)<\/h3>/g;
  const h3Matches = [...segment.matchAll(h3Re)];
  const categories = [];

  const collectItems = (chunk, catName, expectedCount) => {
    const items = [];
    const itemRe = /<div class="item">([\s\S]*?)<\/div>\s*<\/div>/g;
    for (const im of chunk.matchAll(itemRe)) {
      const block = im[1];
      const name = cleanText((block.match(/<div class="name">([\s\S]*?)<\/div>/) || [])[1] || '');
      const desc = cleanText((block.match(/<div class="desc">([\s\S]*?)<\/div>/) || [])[1] || '');
      const urlRaw = cleanText((block.match(/<div class="link">[\s\S]*?<a href="([^"]+)"/) || [])[1] || '');
      let url = '';
      if (/^https?:\/\//i.test(urlRaw)) {
        url = urlRaw;
      } else if (urlRaw) {
        warnings.push(`非 http(s) 链接已置空: [${name}] ${urlRaw}`);
      } else {
        warnings.push(`条目无链接，url 置空: [${name}]`);
      }
      if (!name) {
        warnings.push('发现无名称条目，已跳过');
        continue;
      }
      items.push({ name, desc, url });
    }
    if (expectedCount != null && items.length !== expectedCount) {
      warnings.push(`分类「${catName}」条目数校验不符：声明 ${expectedCount}，实际解析 ${items.length}`);
    }
    return items;
  };

  if (h3Matches.length === 0) {
    const items = collectItems(segment, boardName, null);
    if (items.length) {
      categories.push({ name: boardName, items });
    }
  } else {
    h3Matches.forEach((hm, j) => {
      const catStart = hm.index + hm[0].length;
      const catEnd = j + 1 < h3Matches.length ? h3Matches[j + 1].index : segment.length;
      const chunk = segment.slice(catStart, catEnd);
      const rawCatName = cleanText(hm[1]);
      const expectedCount = extractExpectedCount(rawCatName);
      const catName = stripCountParens(rawCatName);
      const items = collectItems(chunk, catName, expectedCount);
      if (items.length) {
        categories.push({ name: catName, items });
      }
    });
  }

  if (categories.length === 0) {
    warnings.push(`板块「${boardName}」未解析到任何分类/条目`);
    return;
  }

  const boardItems = categories.reduce((sum, c) => sum + c.items.length, 0);
  totalItems += boardItems;
  console.log(`[extract] ${boardSlug} ${boardName}: ${categories.length} 个分类，${boardItems} 条`);

  boards.push({
    name: boardName,
    slug: boardSlug,
    order: boardIndex,
    color: BOARD_COLORS[boardIndex - 1] || 'var(--og-accent)',
    icon: BOARD_ICONS[boardIndex - 1] || 'box',
    fileName: BOARD_FILES[boardIndex - 1] || `board-${boardSlug}.json`,
    categories: categories.map((cat, ci) => ({
      name: cat.name,
      slug: `${boardSlug}-c${ci + 1}`,
      items: cat.items
    }))
  });
});

/* 4. 总数校验 */
console.log('----------------------------------------');
console.log(`[extract] 解析完成：${boards.length} 大板块，共 ${totalItems} 条目（期望 ${EXPECTED_TOTAL}）`);
if (warnings.length) {
  console.warn(`[extract] 警告 ${warnings.length} 条：`);
  warnings.forEach((w) => console.warn(`  - ${w}`));
}
if (totalItems !== EXPECTED_TOTAL) {
  console.error(`[extract] 总条目数 ${totalItems} 与期望 ${EXPECTED_TOTAL} 不符，请人工核对源 HTML`);
  process.exit(1);
}

/* 5. 写出 boards.json（板块与分类唯一定义文件，categories 含 itemCount） */
writeJson(
  join(contentRoot, 'boards.json'),
  boards.map((b) => ({
    name: b.name,
    slug: b.slug,
    order: b.order,
    color: b.color,
    icon: b.icon,
    categories: b.categories.map((c) => ({ name: c.name, slug: c.slug, itemCount: c.items.length }))
  }))
);

/* 6. 写出各分类条目文件（每分类一个文件，文件内为条目数组，不写 id/board/category） */
let writtenItems = 0;
let writtenFiles = 0;
for (const board of boards) {
  for (const cat of board.categories) {
    const items = cat.items.map((it) => ({
      name: it.name,
      desc: it.desc,
      url: it.url,
      tags: []
    }));
    writeJson(join(contentRoot, 'games', board.slug, `${cat.slug}.json`), items);
    writtenItems += items.length;
    writtenFiles += 1;
  }
}
console.log(
  `[extract] 完成：boards.json + ${writtenFiles} 个分类条目文件（games/{boardSlug}/{categorySlug}.json），共 ${writtenItems} 条`
);
