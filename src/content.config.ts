/**
 * Astro 内容集合定义（v2.2 数据层：每分类一文件的条目数组数据集）
 *
 * 数据布局：
 *   src/content/boards.json                 板块与分类的唯一定义文件（数组，categories 含 itemCount）
 *   src/content/games/{boardSlug}/{categorySlug}.json
 *                                           每分类一个文件，内容为「条目数组」；板块/分类 slug 由文件路径推导
 *
 * 条目为扁平对象（手写数据不填 id/slug/board/category，全部由路径与数组顺序推导）：
 *   { "name": "...", "desc": "...", "url": "...", "tags": [] }
 *
 * 加载器：Astro 5 glob loader 对「文件=数组」支持有限，这里用自定义 inline loader：
 *   - 读取 games 目录两级结构，逐数组 emit entry；
 *   - entry id 按数组顺序自动生成为层级 id（b{n}-c{m}-{k}），与 v1 DOM 锚点/收藏键完全一致；
 *   - zod 逐条校验，报错格式：「文件路径 + 第 N 条 + 字段：问题」。
 */
import { defineCollection, z } from 'astro:content';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 单条目的 zod schema（loader 内逐条 safeParse，产生带文件/索引定位的报错） */
const itemSchema = z.object({
  name: z.string().min(1, 'name 不能为空'),
  desc: z.string(),
  url: z
    .string()
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'url 必须以 http(s):// 开头或为空串'),
  tags: z.array(z.string()).default([])
});

const SLUG_RE = /^b\d+$/;
const CAT_SLUG_RE = /^b\d+-c\d+$/;

/** 自定义数据集 loader：games/{boardSlug}/{categorySlug}.json → 每条目一个 entry */
function gamesDatasetLoader() {
  return {
    name: 'games-dataset',
    load({ store }) {
      store.clear();
      /* astro build/dev 均以项目根为 cwd；用 cwd 锚定避免打包后相对路径漂移 */
      const base = resolve(process.cwd(), 'src/content/games');

      const boardDirs = readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && SLUG_RE.test(d.name))
        .map((d) => d.name)
        .sort();

      for (const boardSlug of boardDirs) {
        const dir = join(base, boardSlug);
        for (const fileName of readdirSync(dir).sort()) {
          if (!fileName.endsWith('.json')) continue;
          const categorySlug = fileName.replace(/\.json$/, '');
          if (!CAT_SLUG_RE.test(categorySlug) || !categorySlug.startsWith(`${boardSlug}-`)) {
            throw new Error(
              `[games] ${boardSlug}/${fileName}：文件名必须是与所属板块匹配的分类 slug（形如 ${boardSlug}-c1.json）`
            );
          }
          const filePath = join(dir, fileName);
          let parsed;
          try {
            parsed = JSON.parse(readFileSync(filePath, 'utf8'));
          } catch (err) {
            throw new Error(`[games] ${boardSlug}/${fileName} JSON 解析失败：${err.message}`);
          }
          if (!Array.isArray(parsed)) {
            throw new Error(`[games] ${boardSlug}/${fileName} 的内容必须是条目对象数组`);
          }
          parsed.forEach((raw, i) => {
            const result = itemSchema.safeParse(raw ?? {});
            if (!result.success) {
              const issues = result.error.issues
                .map((is) => `${is.path.join('.') || '(对象)'}：${is.message}`)
                .join('；');
              throw new Error(`[games] ${boardSlug}/${fileName} 第 ${i + 1} 条校验失败：${issues}`);
            }
            /* board/category 由文件路径推导注入；id 按数组顺序生成层级 id */
            store.set({
              id: `${categorySlug}-${i + 1}`,
              data: { ...result.data, board: boardSlug, category: categorySlug }
            });
          });
        }
      }
    }
  };
}

const games = defineCollection({
  loader: gamesDatasetLoader(),
  schema: z.object({
    name: z.string().min(1),
    desc: z.string(),
    url: z.string(),
    tags: z.array(z.string()).default([]),
    board: z.string().regex(SLUG_RE),
    category: z.string().regex(CAT_SLUG_RE)
  })
});

export const collections = { games };
