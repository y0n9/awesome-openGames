/**
 * ui.js —— 客户端辅助交互（v2.0）
 * v2.0 变更：吸收原 render.js 的运行时逻辑（侧栏折叠/当前区高亮/收藏视图过滤）——
 *            v1 中这些依赖运行时渲染，v2.0 侧栏与卡片已由 Astro 构建时直出，
 *            只需在静态 DOM 上挂行为。
 * 不变：暗色模式（og:theme）、收藏夹（og:favorites）、返回顶部 + 滚动进度、移动端抽屉。
 * localStorage 键约定：og:theme / og:favorites（og:recent-searches 归 search.js 管）。
 */
import { ICONS } from './shared.js';

const THEME_KEY = 'og:theme';
const FAV_KEY = 'og:favorites';
const FAV_TIP_ACK_KEY = 'og:fav-tip-ack';

/* --------------------------------- 暗色模式 --------------------------------- */

function initTheme() {
  const root = document.documentElement;
  const btn = document.getElementById('og-theme-btn');
  const iconEl = document.getElementById('og-theme-icon');
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  function paint(theme) {
    root.dataset.theme = theme;
    if (iconEl) {
      /* 图标展示“将切换到”的目标主题（仅替换 path 内容，svg 骨架在 BaseLayout 中） */
      iconEl.innerHTML = ICONS[theme === 'dark' ? 'sun' : 'moon'] || '';
    }
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  }

  function current() {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark'
      ? saved
      : mql.matches
        ? 'dark'
        : 'light';
  }

  paint(current());

  /* 未手动选择过主题时，跟随系统变化 */
  mql.addEventListener('change', () => {
    if (!localStorage.getItem(THEME_KEY)) paint(current());
  });

  btn?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* 忽略持久化失败 */
    }
    paint(next);
  });
}

/* ------------------------------ 收藏说明弹窗 -------------------------------- */

/** 用户是否已确认过收藏说明（勾选"下次不再提示"后写入 localStorage） */
function favTipAcknowledged() {
  try {
    return localStorage.getItem(FAV_TIP_ACK_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function acknowledgeFavTip() {
  try {
    localStorage.setItem(FAV_TIP_ACK_KEY, '1');
  } catch (e) {
    /* 忽略持久化失败：本次会话内仍按已确认处理 */
  }
}

/**
 * 显示收藏说明弹窗（居中模态）。
 * @param {() => void} onConfirm 用户点"知道了"后的回调（执行被拦截的那次收藏）
 */
function showFavoriteTip(onConfirm) {
  const modal = document.getElementById('og-fav-tip');
  const overlay = document.getElementById('og-fav-tip-overlay');
  const checkbox = document.getElementById('og-fav-tip-ack');
  const confirmBtn = document.getElementById('og-fav-tip-confirm');
  if (!modal || !overlay || !confirmBtn) {
    /* 弹窗 DOM 缺失时降级：直接执行，不阻塞收藏 */
    onConfirm();
    return;
  }

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    modal.hidden = true;
    overlay.hidden = true;
    document.body.classList.remove('og-modal-open');
    document.removeEventListener('keydown', onKeydown);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }
  function confirm() {
    if (checkbox?.checked) acknowledgeFavTip();
    cleanup();
    onConfirm();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') cleanup();
    if (e.key === 'Enter' && document.activeElement !== checkbox) confirm();
  }

  const lastFocus = document.activeElement;
  if (checkbox) checkbox.checked = false;
  modal.hidden = false;
  overlay.hidden = false;
  document.body.classList.add('og-modal-open');
  confirmBtn.focus();
  overlay.addEventListener('click', cleanup, { once: true });
  confirmBtn.addEventListener('click', confirm, { once: true });
  document.addEventListener('keydown', onKeydown);
}

/* ---------------------------------- 收藏夹 ---------------------------------- */

function loadFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []);
  } catch (e) {
    return new Set();
  }
}

function saveFavorites(set) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...set]));
  } catch (e) {
    /* 忽略持久化失败 */
  }
}

/** 恢复已收藏卡片状态并更新侧栏收藏徽标 */
function restoreFavorites(favorites) {
  document.querySelectorAll('.og-card').forEach((card) => {
    if (!favorites.has(card.dataset.id)) return;
    card.classList.add('is-fav');
    const btn = card.querySelector('.og-fav-btn');
    if (btn) btn.setAttribute('aria-pressed', 'true');
  });
  updateFavBadge(favorites);
}

function updateFavBadge(favorites) {
  const badge = document.getElementById('og-fav-count');
  if (badge) badge.textContent = String(favorites.size);
}

function initFavorites() {
  const favorites = loadFavorites();
  restoreFavorites(favorites);

  /** 执行一次收藏/取消收藏（纯状态变更），供直接点击与弹窗确认后复用 */
  function toggleFavorite(card, btn) {
    const id = card.dataset.id;
    const isFav = !card.classList.contains('is-fav');
    card.classList.toggle('is-fav', isFav);
    btn.setAttribute('aria-pressed', String(isFav));
    if (isFav) favorites.add(id);
    else favorites.delete(id);
    saveFavorites(favorites);
    updateFavBadge(favorites);

    /* 收藏视图下取消收藏的卡片应立即隐藏 */
    if (document.body.classList.contains('og-fav-only') && !isFav) {
      applyFavoritesView(true);
    }
  }

  /* 卡片星标：容器级事件委托（不为每张卡片绑 listener） */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.og-fav-btn');
    if (!btn) return;
    const card = btn.closest('.og-card');
    if (!card) return;

    /* 首次点击收藏：先弹说明框，确认后再执行本次收藏 */
    if (!favTipAcknowledged()) {
      showFavoriteTip(() => toggleFavorite(card, btn));
      return;
    }
    toggleFavorite(card, btn);
  });
}

/* ------------------------------- 收藏视图过滤 -------------------------------- */

/**
 * 收藏视图切换：body 加 og-fav-only 类，隐藏无收藏条目的分类/板块
 * @param {boolean} favOnly 是否仅显示收藏
 */
function applyFavoritesView(favOnly) {
  document.body.classList.toggle('og-fav-only', favOnly);
  document.querySelectorAll('.og-cat').forEach((cat) => {
    cat.hidden = favOnly && !cat.querySelector('.og-card.is-fav');
  });
  document.querySelectorAll('.og-board').forEach((board) => {
    board.hidden = favOnly && !board.querySelector('.og-cat:not([hidden])');
  });
  const empty = document.getElementById('og-fav-empty');
  if (empty) {
    empty.hidden = !(favOnly && !document.querySelector('.og-card.is-fav'));
  }
}

/* --------------------------- 侧栏行为（v1 render.js 并入） -------------------- */

/** 高亮指定分类的侧栏链接（滚动高亮与点击共用） */
function setActiveCat(catId) {
  document.querySelectorAll('#og-sidebar-nav .og-side-link.active').forEach((el) => {
    el.classList.remove('active');
  });
  const link = document.querySelector(`#og-sidebar-nav [data-cat-link="${catId}"]`);
  if (link) {
    link.classList.add('active');
    /* 确保所在板块展开 */
    const board = link.closest('.og-side-board');
    if (board) board.classList.remove('is-collapsed');
    link.scrollIntoView({ block: 'nearest' });
  }
}

/** 侧栏事件委托：收藏视图切换 / 板块折叠 / 分类跳转即时高亮 */
function bindSidebarEvents() {
  const nav = document.getElementById('og-sidebar-nav');
  nav?.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('[data-og-view]');
    if (viewBtn) {
      document.querySelectorAll('#og-sidebar-nav .og-view-btn').forEach((b) => {
        b.classList.toggle('active', b === viewBtn);
      });
      applyFavoritesView(viewBtn.dataset.ogView === 'fav');
      return;
    }
    const toggle = e.target.closest('[data-board-toggle]');
    if (toggle) {
      const wrap = toggle.closest('.og-side-board');
      const collapsed = wrap.classList.toggle('is-collapsed');
      toggle.setAttribute('aria-expanded', String(!collapsed));
      return;
    }
    const link = e.target.closest('[data-cat-link]');
    if (link) {
      setActiveCat(link.getAttribute('data-cat-link'));
    }
  });
}

/** IntersectionObserver：当前可视区块 → 侧栏高亮 */
function setupScrollSpy() {
  const cats = document.querySelectorAll('.og-cat');
  if (!cats.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveCat(entry.target.id);
        }
      }
    },
    /* 顶部让出 Header 高度，底部提前触发，保证“当前区块”语义 */
    { rootMargin: '-96px 0px -65% 0px', threshold: 0 }
  );
  cats.forEach((cat) => observer.observe(cat));
}

/* ----------------------------- 返回顶部 + 滚动进度 ---------------------------- */

function initBackToTop() {
  const btn = document.getElementById('og-backtop');
  const bar = document.getElementById('og-progress');

  function onScroll() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, scrollTop / max) : 0;
    if (bar) bar.style.width = `${(ratio * 100).toFixed(2)}%`;
    if (btn) btn.hidden = scrollTop <= window.innerHeight;
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScroll();

  btn?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* -------------------------------- 移动端抽屉 --------------------------------- */

function isMobile() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function closeDrawer() {
  document.body.classList.remove('og-drawer-open');
  const menuBtn = document.getElementById('og-menu-btn');
  const overlay = document.getElementById('og-overlay');
  if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  if (overlay) overlay.hidden = true;
}

function initDrawer() {
  const menuBtn = document.getElementById('og-menu-btn');
  const overlay = document.getElementById('og-overlay');
  const sidebar = document.getElementById('og-sidebar');

  menuBtn?.addEventListener('click', () => {
    const open = !document.body.classList.contains('og-drawer-open');
    document.body.classList.toggle('og-drawer-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    if (overlay) overlay.hidden = !open;
  });

  overlay?.addEventListener('click', closeDrawer);

  /* 抽屉内点击分类链接后自动收起（移动端） */
  sidebar?.addEventListener('click', (e) => {
    if (isMobile() && e.target.closest('a.og-side-link')) {
      closeDrawer();
    }
  });

  /* 从移动断点回到桌面时清理抽屉状态 */
  window.matchMedia('(min-width: 768px)').addEventListener('change', (e) => {
    if (e.matches) closeDrawer();
  });
}

/* ---------------------------------- 入口 ------------------------------------ */

/** 初始化全部客户端交互（DOM 由 Astro 构建时直出，脚本经 bundle 延迟执行） */
export function initUI() {
  initTheme();
  initFavorites();
  initBackToTop();
  initDrawer();
  bindSidebarEvents();
  setupScrollSpy();
}
