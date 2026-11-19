/**
 * QA 测试 1 —— 数据完整性（v2.2 布局）：独立解析源 HTML，与 src/content/games/** 全量核对
 * 运行：node tests/test-data-integrity.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/myFile/demoSource/WebToolsProjects/awesome-openGames';
const SRC_HTML = 'C:/Users/Administrator/Downloads/开源游戏与开发工具分类合集.html';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push({ name, detail }); console.log(`  FAIL  ${name}  ${detail}`); }
}

/* ---------- 独立的实体解码 / 清洗（不复用 extract-data.mjs 代码） ---------- */
function decodeEntities(text) {
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', middot: '·', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', times: '×', divide: '÷' };
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}
function cleanText(text) {
  return decodeEntities(String(text).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/* ---------- 独立解析源 HTML：按 h2 锚点切段 → 按 .item 块提取 name/desc/url ---------- */
const html = readFileSync(SRC_HTML, 'utf8');
const h2Positions = [];
const h2Re = /<h2 id="(s\d)"/g;
let m;
while ((m = h2Re.exec(html)) !== null) h2Positions.push({ id: m[1], index: m.index });

const sourceBoards = []; // [{ id, items: [{name, desc, url}] }]，s1 已跳过
for (let i = 0; i < h2Positions.length; i++) {
  const { id } = h2Positions[i];
  const start = h2Positions[i].index;
  const end = i + 1 < h2Positions.length ? h2Positions[i + 1].index : html.length;
  const segment = html.slice(start, end);
  if (id === 's1') continue;

  const items = [];
  // 独立切法：按 '<div class="item">' 分块，块止于下一个结构标记
  const parts = segment.split('<div class="item">');
  for (let p = 1; p < parts.length; p++) {
    const block = parts[p];
    const stop = block.search(/<div class="(item|grpbox|note)"|<h3|<h2/);
    const scope = stop >= 0 ? block.slice(0, stop) : block;
    const nameM = scope.match(/<div class="name">([\s\S]*?)<\/div>/);
    const descM = scope.match(/<div class="desc">([\s\S]*?)<\/div>/);
    const linkM = scope.match(/<a href="(https?:\/\/[^"]+)"/);
    const name = nameM ? cleanText(nameM[1]) : '';
    if (!name) continue;
    items.push({ name, desc: descM ? cleanText(descM[1]) : '', url: linkM ? linkM[1].trim() : '' });
  }
  sourceBoards.push({ id, items });
}

/* ---------- 读取 games/{b?}/*.json 与 boards.json ---------- */
const gamesDir = join(ROOT, 'src/content/games');
const boards = JSON.parse(readFileSync(join(ROOT, 'src/content/boards.json'), 'utf8'));
const searchIndex = JSON.parse(readFileSync(join(ROOT, 'dist/search-index.json'), 'utf8'));

// 聚合：board slug → 有序条目列表（文件名序 + 数组序）
const jsonByBoard = {}; // { b1: [{name, desc, url, board, category, file}], ... }
const itemRecords = [];
const boardDirs = readdirSync(gamesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
for (const boardSlug of boardDirs) {
  jsonByBoard[boardSlug] = [];
  const dir = join(gamesDir, boardSlug);
  for (const fileName of readdirSync(dir).filter((f) => f.endsWith('.json')).sort((a, b) => {
    const pa = a.replace('.json', '').split('-c'), pb = b.replace('.json', '').split('-c');
    return parseInt(pa[1]) - parseInt(pb[1]);
  })) {
    const categorySlug = fileName.replace(/\.json$/, '');
    const arr = JSON.parse(readFileSync(join(dir, fileName), 'utf8'));
    arr.forEach((it, i) => {
      const rec = { ...it, board: boardSlug, category: categorySlug, file: `${boardSlug}/${fileName}`, index: i + 1 };
      jsonByBoard[boardSlug].push(rec);
      itemRecords.push(rec);
    });
  }
}

console.log('\n== 1.1 条目总数核对（源 HTML s2..s7 vs games JSON 全量） ==');
const srcTotal = sourceBoards.reduce((s, b) => s + b.items.length, 0);
console.log(`  源 HTML 条目数（独立解析）：${srcTotal}；games JSON 总条目数：${itemRecords.length}`);
check('总条目数一致且 = 257', srcTotal === itemRecords.length && itemRecords.length === 257, `src=${srcTotal} json=${itemRecords.length}`);

console.log('\n== 1.2 逐板块全量核对（name/desc/url 集合与顺序） ==');
let checked = 0;
for (let i = 0; i < 6; i++) {
  const src = sourceBoards[i];
  const boardSlug = `b${i + 1}`;
  const json = jsonByBoard[boardSlug] || [];
  if (src.items.length !== json.length) {
    check(`${boardSlug} 条目数一致`, false, `src=${src.items.length} json=${json.length}`);
    continue;
  }
  const mismatches = [];
  for (let j = 0; j < src.items.length; j++) {
    const s = src.items[j], d = json[j];
    if (s.name !== d.name) mismatches.push(`#${j + 1} name: src="${s.name}" json="${d.name}"`);
    if (s.desc !== (d.desc || '')) mismatches.push(`#${j + 1} desc: src="${s.desc}" json="${d.desc}"`);
    if (s.url !== d.url) mismatches.push(`#${j + 1} url: src="${s.url}" json="${d.url}"`);
  }
  checked += json.length;
  check(`${boardSlug} 全部 ${json.length} 条 name/desc/url 与源 HTML 一致（含顺序）`, mismatches.length === 0, mismatches.slice(0, 3).join(' | '));
}
console.log(`  （实际逐条核对 ${checked} 条，覆盖全部 6 板块，远超 15 条抽样要求）`);

console.log('\n== 1.3 boards.json 板块/分类定义 vs 源 HTML 分类结构 ==');
check('boards.json 板块数 = 6', boards.length === 6, `got ${boards.length}`);
const srcCatInfo = [];
for (const sb of sourceBoards) {
  const idx = h2Positions.findIndex((h) => h.id === sb.id);
  const end = idx + 1 < h2Positions.length ? h2Positions[idx + 1].index : html.length;
  const segment = html.slice(h2Positions[idx].index, end);
  const h3s = [...segment.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)];
  const cats = [];
  if (h3s.length === 0) {
    // 无 h3 时伪分类名 = 板块名（与产品规格一致）；板块名 = h2 文本去序号前缀与尾部括号说明
    const rawTitle = cleanText(segment.match(/<h2 id="s\d"[^>]*>([\s\S]*?)<\/h2>/)?.[1] || '');
    const boardName = rawTitle.replace(/^[一二三四五六七八九十百]+、\s*/, '').replace(/（[^）]*）\s*$/, '').trim();
    cats.push({ name: boardName, count: sb.items.length });
  } else {
    for (let j = 0; j < h3s.length; j++) {
      const catStart = h3s[j].index + h3s[j][0].length;
      const catEnd = j + 1 < h3s.length ? h3s[j + 1].index : segment.length;
      const chunk = segment.slice(catStart, catEnd);
      const count = (chunk.match(/<div class="item">/g) || []).length;
      const catName = cleanText(h3s[j][1]);
      cats.push({ name: catName, count });
    }
  }
  srcCatInfo.push({ id: sb.id, cats });
}
for (let i = 0; i < 6; i++) {
  const srcCats = srcCatInfo[i].cats.filter((c) => c.count > 0).map((c) => c.name.replace(/（\d+）\s*$/, '').trim());
  const defCats = boards[i].categories.map((c) => c.name);
  check(`b${i + 1} 分类数一致（${defCats.length}）`, srcCats.length === defCats.length, `src=${srcCats.length} json=${defCats.length}`);
  check(`b${i + 1} 分类名一致`, JSON.stringify(srcCats) === JSON.stringify(defCats), `src=[${srcCats.slice(0, 2)}...] json=[${defCats.slice(0, 2)}...]`);
}
check('分类总数 = 27', boards.reduce((s, b) => s + b.categories.length, 0) === 27);

console.log('\n== 1.4 id 唯一性与层级结构（经 dist/search-index.json 验证构建产物） ==');
const itemDocs = searchIndex.docs.filter((d) => d.type === 'item');
const catDocs = searchIndex.docs.filter((d) => d.type === 'category');
check('search-index.json docs = 257 + 27 = 284', searchIndex.docs.length === 284, `got ${searchIndex.docs.length}`);
check('item docs = 257', itemDocs.length === 257, `got ${itemDocs.length}`);
check('category docs = 27', catDocs.length === 27, `got ${catDocs.length}`);
const ids = itemDocs.map((d) => d.id);
check('id 全局唯一', new Set(ids).size === ids.length, `dupes: ${ids.length - new Set(ids).size}`);
check('id 均为层级形式 b{n}-c{m}-{k}', ids.every((id) => /^b\d+-c\d+-\d+$/.test(id)),
  ids.filter((id) => !/^b\d+-c\d+-\d+$/.test(id)).slice(0, 3).join(','));
// id 与分类文件路径推导一致性：id 前缀 = category slug，序号 = 文件内数组序
let idPathOk = true;
const idBad = [];
for (const rec of itemRecords) {
  const expectId = `${rec.category}-${rec.index}`;
  const doc = itemDocs.find((d) => d.id === expectId);
  if (!doc || doc.name !== rec.name || doc.url !== rec.url) { idPathOk = false; idBad.push(expectId); }
}
check('search-index 条目 id=分类 slug+数组序，内容与 games JSON 一致', idPathOk, idBad.slice(0, 3).join(','));
// 每分类内 id 序号连续且从 1 开始
const seqOk = Object.values(jsonByBoard).flat().every((rec) => rec.index >= 1);
check('层级 id 序号从 1 连续编号', seqOk);

console.log('\n== 1.5 boards.json itemCount vs 实际条目数 ==');
const actualCounts = {};
for (const rec of itemRecords) actualCounts[rec.category] = (actualCounts[rec.category] || 0) + 1;
let itemCountOk = true;
const itemCountBad = [];
for (const b of boards) for (const c of b.categories) {
  const actual = actualCounts[c.slug] ?? 0;
  if (c.itemCount !== actual) { itemCountOk = false; itemCountBad.push(`${c.slug}: itemCount=${c.itemCount} actual=${actual}`); }
}
check('boards.json 每分类 itemCount 与实际条目数一致（27/27）', itemCountOk, itemCountBad.slice(0, 5).join(' | '));
const idxCounts = {};
for (const d of itemDocs) idxCounts[d.categoryId] = (idxCounts[d.categoryId] || 0) + 1;
check('search-index 每分类条目数与 boards.json itemCount 一致',
  boards.flatMap((b) => b.categories).every((c) => (idxCounts[c.slug] ?? 0) === c.itemCount));

console.log('\n== 1.6 数据卫生：无空 url、无残留标签、无未解码实体 ==');
const emptyUrl = [];
const tagResidue = [];
const entityResidue = [];
for (const rec of itemRecords) {
  if (!/^https?:\/\//i.test(rec.url || '')) emptyUrl.push(`${rec.file}#${rec.index} [${rec.name}] url="${rec.url}"`);
  for (const field of ['name', 'desc']) {
    const v = rec[field] || '';
    if (/<\/?[a-z][^>]*>/i.test(v)) tagResidue.push(`${rec.file}#${rec.index}.${field}: ${v.slice(0, 60)}`);
    if (/&(#x?[0-9a-fA-F]+|[a-zA-Z]{2,8});/.test(v)) entityResidue.push(`${rec.file}#${rec.index}.${field}: ${v.slice(0, 60)}`);
  }
}
console.log(`  空 url 条目数：${emptyUrl.length}${emptyUrl.length ? '（' + emptyUrl.slice(0, 5).join(' ; ') + '）' : ''}`);
check('无空 url（源 HTML 中对应条目均带链接）', emptyUrl.length === 0, `${emptyUrl.length} 条空 url`);
check('name/desc 无残留 HTML 标签', tagResidue.length === 0, tagResidue.slice(0, 3).join(' | '));
check('name/desc 无未解码 HTML 实体', entityResidue.length === 0, entityResidue.slice(0, 3).join(' | '));

console.log(`\n========== 数据完整性测试结果：${pass} PASS / ${fail} FAIL ==========`);
if (failures.length) { console.log('失败项明细：'); failures.forEach((f) => console.log(` - ${f.name}: ${f.detail}`)); }
process.exit(fail ? 1 : 0);
