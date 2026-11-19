/**
 * search.js —— 全站搜索（MiniSearch 封装，v2.0）
 * v2.0 变更：索引数据改为构建时生成的静态端点 /search-index.json，
 *            首次搜索时懒加载 fetch 后再建 MiniSearch 索引（首屏零同步成本）。
 * 不变：CJK 单字 tokenizer、150ms 防抖、分组下拉 + <mark> 高亮、
 *       ↑↓/Enter/Esc 键盘导航、/ 与 Ctrl+K 快捷键、最近搜索（og:recent-searches，≤5 条）。
 */
import MiniSearch from 'minisearch';
import { escapeHtml, icon } from './shared.js';

/** localStorage 键：最近搜索（≤5 条，PRD 4.4①） */
const RECENT_KEY = 'og:recent-searches';

/** 下拉默认最多展示的条数，超出折叠为“查看全部” */
const MAX_RESULTS = 20;

/** 输入防抖毫秒数 */
const DEBOUNCE_MS = 150;

/**
 * 自定义 tokenizer：每个汉字一个 token + 连续拉丁字母数字一个 token。
 * 查询与索引同源处理，中文子串匹配 = prefix 检索；拼音搜索首版不做（用户决策）。
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text).toLowerCase().match(/\p{Script=Han}|[a-z0-9]+/gu) || [];
}

/**
 * 高亮文本：对 tokens 做单次合并正则替换，避免逐 token 替换时误命中已插入的 <mark> 标签。
 * @param {string} text 原文
 * @param {string[]} tokens 命中 token（小写）
 * @returns {string} HTML（已转义 + <mark> 高亮）
 */
function highlight(text, tokens) {
  const uniq = [...new Set(tokens.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!uniq.length) return escapeHtml(text);
  const pattern = uniq.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(${pattern})`, 'gi');
  return escapeHtml(text).replace(re, '<mark>$1</mark>');
}

/** 读取最近搜索 */
function loadRecent() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch (e) {
    return [];
  }
}

/** 保存一次搜索词（去重、最新在前、最多 5 条） */
function saveRecent(query) {
  const q = query.trim();
  if (!q) return;
  const list = loadRecent().filter((x) => x !== q);
  list.unshift(q);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch (e) {
    /* localStorage 不可用时静默降级 */
  }
}

/** 计算静态搜索索引的 URL（适配 base 子路径部署） */
function searchIndexUrl() {
  const base = import.meta.env.BASE_URL || '/';
  return base.endsWith('/') ? `${base}search-index.json` : `${base}/search-index.json`;
}

/**
 * 初始化全站搜索（索引懒加载：首次搜索时才 fetch search-index.json 并建 MiniSearch 索引）
 */
export function initSearch() {
  const input = document.getElementById('og-search-input');
  const panel = document.getElementById('og-search-panel');
  const status = document.getElementById('og-search-status');
  const clearBtn = document.getElementById('og-search-clear');
  if (!input || !panel) return;

  /* ---------- 懒加载索引（单例 Promise，失败可重试） ---------- */
  let enginePromise = null;
  let boardsMeta = []; // [{id, name, icon}]，保持清单原序

  function loadEngine() {
    if (enginePromise) return enginePromise;
    enginePromise = (async () => {
      const res = await fetch(searchIndexUrl());
      if (!res.ok) throw new Error(`search-index.json 加载失败（HTTP ${res.status}）`);
      const payload = await res.json();
      boardsMeta = Array.isArray(payload.boards) ? payload.boards : [];
      const engine = new MiniSearch({
        fields: ['name', 'desc', 'categoryName', 'boardName'],
        storeFields: ['type', 'name', 'desc', 'url', 'categoryId', 'categoryName', 'boardId', 'boardName'],
        tokenize,
        searchOptions: { prefix: true, boost: { name: 3, desc: 1 } }
      });
      engine.addAll(payload.docs || []);
      return engine;
    })().catch((err) => {
      enginePromise = null; // 允许下次输入重试
      throw err;
    });
    return enginePromise;
  }

  /* ---------- 组件状态 ---------- */
  let debounceTimer = 0;
  let results = []; // 当前全部结果（MiniSearch 得分序）
  let displayList = []; // 浮层实际展示顺序（分组后），行 data-idx 与之对应
  let shownCount = MAX_RESULTS; // 折叠态展示条数
  let activeIndex = -1; // 键盘选中行索引
  let currentQuery = '';

  /* ---------- 浮层渲染 ---------- */

  /** 组装单行结果 */
  function rowHtml(doc, idx, tokens) {
    const isCategory = doc.type === 'category';
    const nameHtml = highlight(doc.name, tokens);
    const descHtml = doc.desc ? highlight(doc.desc, tokens) : '';
    const badge = isCategory ? '分类' : escapeHtml(doc.categoryName);
    return `
      <button class="og-sr-row${isCategory ? ' is-category' : ''}" type="button" role="option" id="og-sr-${idx}" data-idx="${idx}">
        <span class="og-sr-name">${nameHtml}</span>
        ${descHtml ? `<span class="og-sr-desc">${descHtml}</span>` : ''}
        <span class="og-sr-meta">${badge} · ${escapeHtml(doc.boardName)}</span>
      </button>`;
  }

  function renderPanel(tokens) {
    displayList = [];
    const total = results.length;
    if (!total) {
      panel.innerHTML = `
        <div class="og-sr-empty">
          ${icon('globe')}
          <p>没有找到「${escapeHtml(currentQuery)}」，试试其他关键词</p>
          <button class="og-sr-empty-clear" type="button" data-og-sr-clear>清空搜索</button>
        </div>`;
      setStatus('没有找到相关结果');
      return;
    }

    const shown = results.slice(0, shownCount);

    /* 分类结果置顶单独成组，其余按板块分组（板块顺序保持清单原序） */
    const catResults = shown.filter((d) => d.type === 'category');
    const itemResults = shown.filter((d) => d.type !== 'category');
    const groups = new Map();
    for (const board of boardsMeta) {
      const hits = itemResults.filter((d) => d.boardId === board.id);
      if (hits.length) groups.set(board.id, hits);
    }

    let html = '';
    const flush = (list) => {
      for (const doc of list) {
        html += rowHtml(doc, displayList.length, tokens);
        displayList.push(doc);
      }
    };

    if (catResults.length) {
      html += '<div class="og-sr-group"><div class="og-sr-group-head">分类</div>';
      flush(catResults);
      html += '</div>';
    }
    for (const [boardId, hits] of groups) {
      const board = boardsMeta.find((b) => b.id === boardId);
      html += `
        <div class="og-sr-group">
          <div class="og-sr-group-head" style="--board-color:var(--og-board-${boardId})">
            ${icon(board ? board.icon : 'box')}${escapeHtml(board ? board.name : boardId)}
          </div>`;
      flush(hits);
      html += '</div>';
    }

    if (total > shownCount) {
      html += `<button class="og-sr-more" type="button" data-og-sr-more>查看全部 ${total} 条</button>`;
    }
    panel.innerHTML = html;
    setStatus(`共 ${total} 条结果`);
    if (activeIndex >= displayList.length) setActive(displayList.length - 1);
  }

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  /** 打开结果：条目 → 新标签打开源码；分类 → 锚点平滑滚动 */
  function openResult(doc) {
    saveRecent(currentQuery);
    closePanel();
    if (doc.type === 'category' || !doc.url) {
      window.location.hash = `#${doc.categoryId}`;
      return;
    }
    window.open(doc.url, '_blank', 'noopener');
  }

  /* ---------- 选中态与键盘导航 ---------- */

  function rows() {
    return [...panel.querySelectorAll('.og-sr-row')];
  }

  function setActive(index) {
    const list = rows();
    if (!list.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(index, list.length - 1));
    list.forEach((row, i) => {
      row.classList.toggle('active', i === activeIndex);
      row.setAttribute('aria-selected', String(i === activeIndex));
    });
    list[activeIndex].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', list[activeIndex].id);
  }

  function moveActive(delta) {
    if (!displayList.length) return;
    setActive(activeIndex < 0 ? 0 : activeIndex + delta);
  }

  /* ---------- 面板开合 ---------- */

  function openPanel() {
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function renderRecent() {
    const list = loadRecent();
    if (!list.length) {
      panel.innerHTML = '<div class="og-sr-recent-empty">输入关键词开始搜索，支持中文与英文</div>';
      return;
    }
    panel.innerHTML = `
      <div class="og-sr-recent">
        <div class="og-sr-group-head">最近搜索</div>
        <div class="og-sr-recent-chips">
          ${list.map((q) => `<button class="og-sr-chip" type="button" data-og-recent="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}
        </div>
      </div>`;
  }

  /* ---------- 搜索执行（异步：首次需加载索引） ---------- */

  async function doSearch(rawQuery) {
    const q = rawQuery.trim();
    currentQuery = q;
    shownCount = MAX_RESULTS;
    if (!q) {
      results = [];
      closePanel();
      clearBtn.hidden = true;
      setStatus('');
      return;
    }
    clearBtn.hidden = false;
    setStatus('搜索索引加载中…');
    let engine;
    try {
      engine = await loadEngine();
    } catch (err) {
      results = [];
      panel.innerHTML = `
        <div class="og-sr-empty">
          ${icon('globe')}
          <p>搜索索引加载失败，请检查网络后重试</p>
          <button class="og-sr-empty-clear" type="button" data-og-sr-clear>清空搜索</button>
        </div>`;
      setStatus('索引加载失败');
      openPanel();
      return;
    }
    /* 索引加载期间用户可能已改输入，过期结果直接丢弃 */
    if (q !== currentQuery) return;
    results = engine.search(q);
    renderPanel(tokenize(q));
    setActive(-1);
    openPanel();
  }

  /* ---------- 事件绑定 ---------- */

  input.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => doSearch(input.value), DEBOUNCE_MS);
  });

  input.addEventListener('focus', () => {
    if (!input.value.trim()) {
      renderRecent();
      openPanel();
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (panel.hidden) openPanel();
      else moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const list = rows();
      if (activeIndex >= 0 && list[activeIndex]) {
        const doc = displayList[Number(list[activeIndex].dataset.idx)];
        if (doc) openResult(doc);
      } else if (displayList.length) {
        openResult(displayList[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (!panel.hidden) {
        closePanel();
      } else {
        input.value = '';
        doSearch('');
        input.blur();
      }
    }
  });

  /* 面板点击委托：结果行 / 查看全部 / 清空 / 最近搜索 */
  panel.addEventListener('click', (e) => {
    const more = e.target.closest('[data-og-sr-more]');
    if (more) {
      shownCount = results.length;
      renderPanel(tokenize(currentQuery));
      return;
    }
    const clear = e.target.closest('[data-og-sr-clear]');
    if (clear) {
      input.value = '';
      doSearch('');
      input.focus();
      return;
    }
    const chip = e.target.closest('[data-og-recent]');
    if (chip) {
      input.value = chip.getAttribute('data-og-recent');
      doSearch(input.value);
      return;
    }
    const row = e.target.closest('.og-sr-row');
    if (row) {
      const doc = displayList[Number(row.dataset.idx)];
      if (doc) openResult(doc);
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    doSearch('');
    input.focus();
  });

  /* 点击浮层以外关闭 */
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.target.closest('#og-search')) {
      closePanel();
    }
  });

  /* 全局快捷键：/ 聚焦（非输入态）、Ctrl/⌘+K 聚焦并全选 */
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      input.focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}
