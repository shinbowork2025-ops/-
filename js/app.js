// エントリポイント: ルーティング・日付変更検出・FAB・PWA登録

import * as store from './store.js';
import { toast } from './ui.js';
import * as home from './views/home.js';
import * as schedule from './views/schedule.js';
import * as todo from './views/todo.js';
import * as questions from './views/questions.js';
import * as orders from './views/orders.js';
import * as summary from './views/summary.js';
import * as settings from './views/settings.js';

const ROUTES = {
  home:      { view: home,      title: 'ホーム' },
  schedule:  { view: schedule,  title: 'スケジュール' },
  todo:      { view: todo,      title: '当日TODO' },
  questions: { view: questions, title: '質問記録' },
  orders:    { view: orders,    title: '客注' },
  summary:   { view: summary,   title: '日次集計' },
  settings:  { view: settings,  title: '設定' },
};

let currentRoute = 'home';
let rendering = false;

function routeFromHash() {
  const name = (location.hash || '#/home').replace(/^#\//, '');
  return ROUTES[name] ? name : 'home';
}

async function renderCurrent({ preserveScroll = false } = {}) {
  if (rendering) return;
  rendering = true;
  try {
    const el = document.getElementById('view');
    const scrollY = window.scrollY;
    await ROUTES[currentRoute].view.render(el);
    if (preserveScroll) window.scrollTo(0, scrollY);
  } finally {
    rendering = false;
  }
}

async function navigate() {
  const next = routeFromHash();
  if (next !== 'schedule' && currentRoute === 'schedule') schedule.resetMode();
  currentRoute = next;
  document.getElementById('topbar-title').textContent = ROUTES[next].title;
  document.querySelectorAll('#bottomnav a').forEach(a =>
    a.classList.toggle('active', a.dataset.route === next));
  await store.refreshDay({ silent: true });
  await renderCurrent();
  closeFabMenu();
}

// ---- FAB ----

function closeFabMenu() {
  document.getElementById('fab-menu').classList.add('hidden');
  document.getElementById('fab-main').textContent = '＋';
}

function setupFab() {
  const main = document.getElementById('fab-main');
  const menu = document.getElementById('fab-menu');
  main.addEventListener('click', () => {
    const hidden = menu.classList.toggle('hidden');
    main.textContent = hidden ? '＋' : '✕';
  });
  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('.fab-item');
    if (!btn) return;
    closeFabMenu();
    await store.refreshDay();
    if (btn.dataset.fab === 'todo') todo.openTodoForm();
    else if (btn.dataset.fab === 'customer') questions.startCustomerTimer();
    else if (btn.dataset.fab === 'order') orders.openOrderForm();
  });
}

// ---- 起動 ----

async function main() {
  // 永続ストレージの要求(拒否されてもアプリは動く)
  if (navigator.storage && navigator.storage.persist) {
    try {
      const already = await navigator.storage.persisted();
      store.setPersisted(already || await navigator.storage.persist());
    } catch {
      store.setPersisted(null);
    }
  }

  const r = await store.init();
  if (r.closedDate) toast(`前回(${r.closedDate})の記録を日次集計へ保存しました`, 3500);

  store.onChange(() => renderCurrent({ preserveScroll: true }));
  window.addEventListener('app:rerender', () => renderCurrent({ preserveScroll: true }));
  window.addEventListener('hashchange', navigate);

  // 再表示時の日付変更チェック
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') store.refreshDay();
  });

  // ホームの時計・残り時間を1分ごとに更新
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (currentRoute === 'home' || currentRoute === 'schedule') {
      renderCurrent({ preserveScroll: true });
    }
  }, 60000);

  document.getElementById('btn-summary').addEventListener('click', () => { location.hash = '#/summary'; });
  document.getElementById('btn-settings').addEventListener('click', () => { location.hash = '#/settings'; });

  setupFab();
  await navigate();

  // Service Worker登録(PWA・オフライン対応)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed', err);
    });
  }
}

main().catch(err => {
  console.error(err);
  document.getElementById('view').innerHTML =
    `<div class="banner alert">起動エラー: ${String(err && err.message || err)}</div>`;
});
