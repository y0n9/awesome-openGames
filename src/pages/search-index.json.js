/**
 * 静态端点：/search-index.json（构建时生成，v2.1）
 * 数据经 dataset.js 装配（boards.json 定义 + games 集合多文件条目数组）。
 * 输出扁平化搜索文档：条目 + 分类伪文档（分类名可命中并定位），板块元数据供分组展示。
 * 文档顺序保持源清单层级原序（板块 order → 分类定义序 → 条目序），
 * 满足 PRD「同权重按原清单顺序」的排序要求。
 */
import { getCollection } from 'astro:content';
import { buildDataset } from '../js/dataset.js';

export async function GET() {
  const { boards, items } = buildDataset(await getCollection('games'));

  const catById = new Map();
  for (const board of boards) {
    for (const cat of board.categories) {
      catById.set(cat.slug, cat);
    }
  }
  const boardBySlug = new Map(boards.map((b) => [b.slug, b]));

  const docs = [];
  for (const board of boards) {
    for (const cat of board.categories) {
      /* 分类伪文档：命中后定位到分类锚点 */
      docs.push({
        type: 'category',
        id: `cat:${cat.slug}`,
        name: cat.name,
        desc: '',
        url: '',
        categoryId: cat.slug,
        categoryName: cat.name,
        boardId: board.slug,
        boardName: board.name
      });
      for (const item of items.filter((it) => it.category === cat.slug)) {
        docs.push({
          type: 'item',
          id: item.id,
          name: item.name,
          desc: item.desc,
          url: item.url,
          categoryId: item.category,
          categoryName: catById.get(item.category)?.name ?? '',
          boardId: item.board,
          boardName: boardBySlug.get(item.board)?.name ?? ''
        });
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    totalItems: items.length,
    boards: boards.map((b) => ({ id: b.slug, name: b.name, icon: b.icon })),
    docs
  };

  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
