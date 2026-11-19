/**
 * Astro 构建配置（v2.0，自 Vite 方案迁移）
 * - base：默认 '/'（GitHub Pages 用户/组织根站点或 Cloudflare Pages 根路径部署）。
 *   若部署到项目子路径 https://<user>.github.io/<repo>/，设 ASTRO_BASE=/<repo>/
 *   （兼容旧变量名 VITE_BASE）。仅影响资源与端点 URL 前缀，锚点跳转不受影响。
 * - site：留空，由部署方在环境变量/部署平台填写。
 * - 产物为纯静态目录 dist/（Astro 构建时直出全部卡片 HTML，无 SPA 路由）。
 */
import { defineConfig } from 'astro/config';

const base = process.env.ASTRO_BASE || process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  build: {
    inlineStylesheets: 'auto'
  }
});
