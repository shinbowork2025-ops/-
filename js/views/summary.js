// 日次集計の閲覧

import * as db from '../db.js';
import { esc, fmtDateJa } from '../util.js';
import { confirmDialog, openModal } from '../ui.js';

let monthFilter = 'all'; // 'all' | 'YYYY-MM'

function rerender() { window.dispatchEvent(new Event('app:rerender')); }

export async function render(el) {
  const summaries = (await db.getSummaries()).sort((a, b) => (a.date < b.date ? 1 : -1));
  const months = [...new Set(summaries.map(s => s.date.slice(0, 7)))];
  if (monthFilter !== 'all' && !months.includes(monthFilter)) monthFilter = 'all';
  const list = monthFilter === 'all' ? summaries : summaries.filter(s => s.date.slice(0, 7) === monthFilter);

  el.innerHTML = `
    <div class="card">
      <h3>日次集計(日付が変わると自動で作成されます)</h3>
      <select data-f="month">
        <option value="all">すべての月</option>
        ${months.map(m => `<option value="${m}" ${m === monthFilter ? 'selected' : ''}>${m.replace('-', '年')}月</option>`).join('')}
      </select>
      <div class="mt8">
        ${list.length === 0 ? '<div class="muted">集計データはまだありません</div>' : list.map(s => `
          <div class="sum-date-item" data-date="${s.date}">
            <div>
              <b>${fmtDateJa(s.date)}</b>
              <div class="muted">質問${s.questions.total}件 / TODO ${s.todo.done}/${s.todo.total}件完了 / 予定${Math.round(s.schedule.filledMinutes / 60 * 10) / 10}h</div>
            </div>
            <span>›</span>
          </div>`).join('')}
      </div>
    </div>`;

  el.querySelector('[data-f="month"]').addEventListener('change', (e) => {
    monthFilter = e.target.value;
    rerender();
  });
  el.querySelectorAll('.sum-date-item').forEach(row => {
    row.addEventListener('click', () => {
      const s = summaries.find(x => x.date === row.dataset.date);
      if (s) openDetail(s);
    });
  });
}

function table(obj, unit = '件') {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '<div class="muted">なし</div>';
  keys.sort((a, b) => obj[b] - obj[a]);
  return `<table class="sum-table">${keys.map(k =>
    `<tr><td>${esc(k)}</td><td class="num">${obj[k]}${unit}</td></tr>`).join('')}</table>`;
}

function openDetail(s) {
  const q = s.questions;
  const m = openModal(`
    <div class="modal-head"><h2>${fmtDateJa(s.date)}</h2><button class="modal-close">✕</button></div>

    <div class="card"><h3>🕒 スケジュール</h3>
      ${table(s.schedule.byItem, '分')}
      <div class="muted mt8">予定あり ${s.schedule.filledMinutes}分 / 未入力 ${s.schedule.emptyMinutes}分</div>
    </div>

    <div class="card"><h3>✅ TODO</h3>
      <table class="sum-table">
        <tr><td>登録</td><td class="num">${s.todo.total}件</td></tr>
        <tr><td>完了</td><td class="num">${s.todo.done}件</td></tr>
        <tr><td>未完了</td><td class="num">${s.todo.notDone}件</td></tr>
        <tr><td>急ぎ</td><td class="num">${s.todo.urgent}件</td></tr>
      </table>
    </div>

    <div class="card"><h3>❓ お客様質問</h3>
      <table class="sum-table">
        <tr><td>質問件数</td><td class="num">${q.total}件</td></tr>
        <tr><td>解決</td><td class="num">${q.resolved}件</td></tr>
        <tr><td>担当者へ引継ぎ</td><td class="num">${q.handoff}件</td></tr>
        <tr><td>未解決</td><td class="num">${q.unresolved}件</td></tr>
        <tr><td>合計所要時間</td><td class="num">${q.totalMin}分</td></tr>
        <tr><td>平均所要時間</td><td class="num">${q.avgMin}分</td></tr>
        <tr><td>最長所要時間</td><td class="num">${q.maxMin}分</td></tr>
      </table>
      <h3 class="mt12">結末別(複数選択はそれぞれ1件)</h3>${table(q.byOutcome || {})}
      <h3 class="mt12">時間帯別</h3>${table(q.byHour)}
      <h3 class="mt12">質問された場所</h3>${table(q.byPlace)}
      <h3 class="mt12">案内した場所</h3>${table(q.byDest)}
      <h3 class="mt12">陳列データ</h3>${table(q.byDisplay)}
      <h3 class="mt12">使用した手段</h3>${table(q.byTool)}
    </div>

    <button class="btn ghost-danger block" data-act="delete">この日の集計を削除</button>
  `);
  m.el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!await confirmDialog(`${fmtDateJa(s.date)}の集計を削除しますか?`, { okLabel: '削除する', danger: true })) return;
    await db.deleteSummary(s.date);
    m.close();
    rerender();
  });
}
