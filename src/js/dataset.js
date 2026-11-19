/**
 * dataset.js —— 构建期数据集装配（v2.2）
 * 仅供 .astro 页面 / 静态端点的前置代码（frontmatter）导入，不会进入客户端 bundle。
 *
 * 数据布局（v2.2）：
 *   src/content/boards.json —— 板块与分类唯一定义文件（categories 含 itemCount）
 *   src/content/games/{boardSlug}/{categorySlug}.json —— 每分类一个条目数组文件
 *
 * content.config.ts 的自定义 loader 已完成：
 *   条目扁平校验（zod，报错含文件+索引）、board/category 由路径推导注入、
 *   id 按数组顺序生成为层级 id（b{n}-c{m}-{k}，与 v1 DOM 锚点/收藏键一致）。
 *
 * 本模块职责：
 * 1. 校验 boards.json 结构（含 slug 模式、分类 slug 前缀、itemCount 与实际条数一致性）；
 * 2. 对 loader 产出的条目做板块/分类引用一致性校验（报错含 entry id + 条目名）；
 * 3. 排序（层级 id 数值序）并提供按分类/板块的分组视图。
 */
import boardsJson from '../content/boards.json';

const BOARD_SLUG_RE = /^b\d+$/;
const CAT_SLUG_RE = /^b\d+-c\d+$/;

/**
 * 层级 id 数值比较：b1-c2-10 应排在 b1-c2-2 之后（字符串比较会错）。
 * 提取 id 中全部数字段逐位比较；非层级 id 退化为字符串比较。
 */
function compareIds(a, b) {
  const na = String(a).match(/\d+/g);
  const nb = String(b).match(/\d+/g);
  if (!na || !nb) return String(a).localeCompare(String(b));
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i += 1) {
    const x = parseInt(na[i] ?? '0', 10);
    const y = parseInt(nb[i] ?? '0', 10);
    if (x !== y) return x - y;
  }
  return 0;
}

function requireString(obj, key, where) {
  const v = obj ? obj[key] : undefined;
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`[dataset] ${where} 缺少有效的「${key}」字段`);
  }
  return v.trim();
}

/** 校验 boards.json，返回排序后的板块定义（含分类列表与 itemCount） */
function validateBoards(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('[dataset] boards.json 必须是非空数组');
  }
  const seenBoards = new Set();
  const boards = raw.map((b, i) => {
    const where = `boards.json 第 ${i + 1} 个板块`;
    const slug = requireString(b, 'slug', where);
    if (!BOARD_SLUG_RE.test(slug)) {
      throw new Error(`[dataset] ${where} slug「${slug}」必须形如 b1`);
    }
    if (seenBoards.has(slug)) {
      throw new Error(`[dataset] ${where} slug「${slug}」重复`);
    }
    seenBoards.add(slug);
    const name = requireString(b, 'name', where);

    const cats = Array.isArray(b.categories) ? b.categories : [];
    const seenCats = new Set();
    const categories = cats.map((c, j) => {
      const cWhere = `${where} 第 ${j + 1} 个分类`;
      const catSlug = requireString(c, 'slug', cWhere);
      if (!CAT_SLUG_RE.test(catSlug)) {
        throw new Error(`[dataset] ${cWhere} slug「${catSlug}」必须形如 b1-c1`);
      }
      if (!catSlug.startsWith(`${slug}-`)) {
        throw new Error(`[dataset] ${cWhere} slug「${catSlug}」必须以所属板块 slug「${slug}-」开头`);
      }
      if (seenCats.has(catSlug)) {
        throw new Error(`[dataset] ${cWhere} slug「${catSlug}」重复`);
      }
      seenCats.add(catSlug);
      const itemCount = typeof c.itemCount === 'number' ? c.itemCount : null;
      if (itemCount != null && (!Number.isInteger(itemCount) || itemCount < 1)) {
        throw new Error(`[dataset] ${cWhere}（${catSlug}）itemCount 必须是正整数，实际：${itemCount}`);
      }
      return { name: requireString(c, 'name', cWhere), slug: catSlug, itemCount };
    });

    return {
      name,
      slug,
      order: typeof b.order === 'number' ? b.order : i + 1,
      color: typeof b.color === 'string' && b.color ? b.color : 'var(--og-accent)',
      icon: typeof b.icon === 'string' && b.icon ? b.icon : 'box',
      categories
    };
  });
  boards.sort((a, b) => a.order - b.order);
  return boards;
}

/**
 * 装配数据集
 * @param {Array<{id: string, data: object}>} gameEntries getCollection('games') 结果（loader 已注入 board/category/id）
 * @returns {{boards: Array, items: Array}} 板块定义 + 排序后的条目数组
 */
export function buildDataset(gameEntries) {
  const boards = validateBoards(boardsJson);
  const boardBySlug = new Map(boards.map((b) => [b.slug, b]));

  /* 引用一致性校验 + 收集 */
  const items = [];
  for (const entry of [...gameEntries].sort((a, b) => compareIds(a.id, b.id))) {
    const data = entry.data ?? {};
    const name = typeof data.name === 'string' ? data.name : '';
    const board = boardBySlug.get(data.board);
    if (!board) {
      throw new Error(`[dataset] 条目 ${entry.id}（${name}）board「${data.board}」不是 boards.json 中已定义的板块`);
    }
    const cat = board.categories.find((c) => c.slug === data.category);
    if (!cat) {
      throw new Error(
        `[dataset] 条目 ${entry.id}（${name}）category「${data.category}」不是板块 ${data.board} 下已定义的分类（boards.json）`
      );
    }
    items.push({
      id: entry.id,
      name,
      desc: typeof data.desc === 'string' ? data.desc : '',
      url: typeof data.url === 'string' ? data.url : '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      board: data.board,
      category: data.category
    });
  }

  /* boards.json 的 itemCount 与实际条数一致性校验 */
  const actualCounts = new Map();
  for (const item of items) {
    actualCounts.set(item.category, (actualCounts.get(item.category) ?? 0) + 1);
  }
  for (const board of boards) {
    for (const cat of board.categories) {
      const actual = actualCounts.get(cat.slug) ?? 0;
      if (cat.itemCount != null && actual !== cat.itemCount) {
        throw new Error(
          `[dataset] 分类 ${cat.slug}（${board.slug}/${cat.slug}.json）的 itemCount=${cat.itemCount} 与实际条目数 ${actual} 不符`
        );
      }
    }
  }

  return { boards, items };
}

/** 条目按分类 slug 分组：Map<categorySlug, items[]>（组内保持数据集顺序） */
export function groupItemsByCategory(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category).push(item);
  }
  return map;
}

/** 分类条目数：Map<categorySlug, count> */
export function countItemsByCategory(items) {
  const map = new Map();
  for (const item of items) {
    map.set(item.category, (map.get(item.category) ?? 0) + 1);
  }
  return map;
}
