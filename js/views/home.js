// ホーム画面

import * as db from '../db.js';
import * as store from '../store.js';
import { DAY_START, DAY_END, esc, minToLabel, nowMin, slotStartMin, slotIndexAt, fmtDateJa, todayStr } from '../util.js';
import { confirmDialog } from '../ui.js';
import { groupBlocks } from './schedule.js';
import { endCustomerTimer } from './questions.js';

const BACKUP_REMIND_DAYS = 7;

export async function render(el) {
  const daily = store.getDaily();
  const presets = await db.getPresets();
  const orders = await db.getOrders();
  const meta = await db.getMeta();
  const now = nowMin();

  let html = `<div class="home-clock">${fmtDateJa(todayStr())}　現在 <b>${minToLabel(now)}</b></div>`;

  // 警告バナー
  if (store.isPersisted() === false) {
    html += `<div class="banner alert">⚠ ブラウザにデータの永続保存が許可されていません。端末の空き容量が減るとデータが消える場合があります。ホーム画面へのインストールと、こまめなバックアップをおすすめします。</div>`;
  }
  const hasData = orders.length > 0 || (await db.getSummaries()).length > 0;
  const lastBackup = meta.lastBackupAt ? new Date(meta.lastBackupAt) : null;
  const backupAgeDays = lastBackup ? (Date.now() - lastBackup.getTime()) / 86400000 : Infinity;
  if (hasData && backupAgeDays > BACKUP_REMIND_DAYS) {
    const when = lastBackup ? `${Math.floor(backupAgeDays)}日前` : 'まだ一度もありません';
    html += `<div class="banner">💾 最後のバックアップ: ${when}。<a href="#/settings">設定</a>からJSONバックアップを取ってください。</div>`;
  }

  // お客様対応中
  if (daily.activeTimer) {
    const sec = Math.max(0, (Date.now() - new Date(daily.activeTimer.startedAt).getTime()) / 1000);
    const min = Math.floor(sec / 60);
    html += `
      <div class="card timer-card">
        <h3>🙋 お客様対応中</h3>
        <div class="elapsed">経過 ${min}分</div>
        ${daily.activeTimer.scheduledLabel ? `<div class="muted">本来の予定：${esc(daily.activeTimer.scheduledLabel)}</div>` : ''}
        <div class="btn-row">
          <button class="btn small" data-act="timer-discard">破棄</button>
          <button class="btn primary" data-act="timer-end">対応終了</button>
        </div>
      </div>`;
  }

  // 今やること / 次の予定
  if (now < DAY_START || now >= DAY_END) {
    html += `<div class="card now-block"><h3>今やること</h3><div class="big">時間外です</div>
      <div class="muted">スケジュール対象時間: ${minToLabel(DAY_START)}〜${minToLabel(DAY_END)}</div></div>`;
  } else {
    const blocks = groupBlocks(daily.schedule);
    const idx = slotIndexAt(now);
    const cur = blocks.find(b => b.slot !== null && b.start <= idx && idx < b.end);
    if (cur) {
      const endMin = slotStartMin(cur.end);
      html += `
        <div class="card now-block">
          <h3>今やること</h3>
          <div class="muted">${minToLabel(slotStartMin(cur.start))}〜${minToLabel(endMin)}</div>
          <div class="task-name">${esc(db.slotLabel(cur.slot, presets))}</div>
          <div class="muted">残り ${endMin - now}分</div>
        </div>`;
    } else {
      html += `<div class="card now-block"><h3>今やること</h3><div class="big">予定なし</div>
        <div class="muted"><a href="#/schedule">スケジュールを編集する</a></div></div>`;
    }
    const next = blocks.find(b => b.slot !== null && b.start > (cur ? cur.end - 1 : idx));
    if (next) {
      html += `
        <div class="card">
          <h3>次の予定</h3>
          <div class="muted">${minToLabel(slotStartMin(next.start))}〜${minToLabel(slotStartMin(next.end))}</div>
          <div class="big">${esc(db.slotLabel(next.slot, presets))}</div>
        </div>`;
    }
  }

  // 未完了TODO
  const openTodos = daily.todos.filter(t => t.status !== 'done');
  const preview = [...openTodos].sort((a, b) =>
    (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1)).slice(0, 3);
  html += `
    <div class="card">
      <h3>✅ 未完了TODO　${openTodos.length}件</h3>
      ${preview.length === 0 ? '<div class="muted">なし</div>' : preview.map(t => `
        <div class="todo-meta" style="font-size:15px; padding:3px 0;">
          ${t.priority === 'urgent' ? '<span class="tag urgent">急ぎ</span>' : ''}
          <span>${esc(t.text)}</span>
        </div>`).join('')}
      <div class="muted mt8"><a href="#/todo">TODO一覧へ</a></div>
    </div>`;

  // 客注
  const active = orders.filter(o => o.status !== 's7');
  const toOrder = orders.filter(o => o.status === 's1' || o.status === 's2').length;
  const toCall = orders.filter(o => o.status === 's4').length;
  html += `
    <div class="card">
      <h3>📦 客注　未完了 ${active.length}件</h3>
      <div class="count-badges">
        <span class="count-badge ${toOrder ? 'hot' : ''}">要発注 ${toOrder}件</span>
        <span class="count-badge ${toCall ? 'hot' : ''}">⚠ 要連絡 ${toCall}件</span>
      </div>
      <div class="muted mt8"><a href="#/orders">客注一覧へ</a></div>
    </div>`;

  el.innerHTML = html;

  // タイマー操作
  const endBtn = el.querySelector('[data-act="timer-end"]');
  if (endBtn) endBtn.addEventListener('click', () => endCustomerTimer());
  const discardBtn = el.querySelector('[data-act="timer-discard"]');
  if (discardBtn) discardBtn.addEventListener('click', async () => {
    if (await confirmDialog('対応タイマーを記録せずに破棄しますか?', { okLabel: '破棄する', danger: true })) {
      await store.mutateDaily(d => { d.activeTimer = null; });
    }
  });
}
