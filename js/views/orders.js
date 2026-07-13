// 客注管理(日をまたいで保存)

import * as db from '../db.js';
import { esc, fmtDateTime, isKatakanaOnly, normalizeKanaName } from '../util.js';
import { actionSheet, confirmDialog, openModal, toast } from '../ui.js';

const CASE_PREFIX = '100'; // 案件番号は先頭100固定+続きの数字

// 一覧の検索・絞り込み状態(画面遷移しても保持する)
const viewState = {
  tab: 'active',        // 'active' | 'done'
  purpose: 'all',       // ORDER_PURPOSE_FILTERS の id
  status: 'all',        // 'all' | status id
  query: '',
};

function rerender() { window.dispatchEvent(new Event('app:rerender')); }

// 検索入力で再描画した後もフォーカスを戻す
let focusQueryAfterRender = false;

export async function render(el) {
  const orders = await db.getOrders();
  const activeCount = orders.filter(o => o.status !== 's7').length;

  let list = orders.filter(o => viewState.tab === 'done' ? o.status === 's7' : o.status !== 's7');

  if (viewState.tab === 'active') {
    if (viewState.status !== 'all') {
      list = list.filter(o => o.status === viewState.status);
    } else {
      const pf = db.ORDER_PURPOSE_FILTERS.find(f => f.id === viewState.purpose);
      if (pf) list = list.filter(o => pf.statuses.includes(o.status));
    }
  }

  const q = viewState.query.trim();
  if (q) {
    if (/^[0-9]+$/.test(q)) {
      // 数字のみは案件番号優先。ヒットしなければ名前・メモも検索
      const byNo = list.filter(o => String(o.caseNumber).includes(q));
      list = byNo.length ? byNo
        : list.filter(o => o.customerNameKana.includes(q) || (o.memo || '').includes(q));
    } else {
      list = list.filter(o =>
        o.customerNameKana.includes(q) ||
        (o.memo || '').includes(q) ||
        String(o.caseNumber).includes(q));
    }
  }

  list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  const purposeChips = db.ORDER_PURPOSE_FILTERS.map(f =>
    `<button class="chip ${viewState.purpose === f.id && viewState.status === 'all' ? 'on' : ''}" data-purpose="${f.id}">${f.label}</button>`).join('');
  const statusOptions = ['<option value="all">状態で絞り込み…</option>']
    .concat(db.ORDER_STATUSES.filter(s => s.id !== 's7').map(s =>
      `<option value="${s.id}" ${viewState.status === s.id ? 'selected' : ''}>${s.label}</option>`)).join('');

  el.innerHTML = `
    <div class="order-filters">
      <div class="seg">
        <button data-tab="active" class="${viewState.tab === 'active' ? 'on' : ''}">未完了 ${activeCount}件</button>
        <button data-tab="done" class="${viewState.tab === 'done' ? 'on' : ''}">完了済み</button>
      </div>
      <input type="text" data-f="query" placeholder="名前・案件番号・メモで検索" value="${esc(viewState.query)}">
      ${viewState.tab === 'active' ? `
        <div class="chips mt8">${purposeChips}</div>
        <select data-f="status" class="mt8">${statusOptions}</select>` : ''}
    </div>
    <div class="card" style="padding:0 14px">
      ${list.length === 0 ? '<div class="muted" style="padding:14px 0">該当する客注はありません</div>' : list.map(o => `
        <div class="order-item" data-id="${o.id}">
          <div class="order-main" data-act="detail">
            <div class="order-no">No.${o.caseNumber}　<span style="font-weight:400">${fmtDateTime(o.updatedAt)}</span></div>
            <div class="order-name">${esc(o.customerNameKana)} 様</div>
            ${o.memo ? `<div class="order-memo">${esc(o.memo.split('\n')[0])}</div>` : ''}
          </div>
          <button class="status-badge st-${o.status}" data-act="status">${db.statusLabel(o.status)}</button>
        </div>`).join('')}
    </div>
    <button class="btn primary block" data-act="add">＋ 客注を追加</button>`;

  // フィルタ操作
  el.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    viewState.tab = b.dataset.tab; rerender();
  }));
  el.querySelectorAll('[data-purpose]').forEach(b => b.addEventListener('click', () => {
    viewState.purpose = b.dataset.purpose; viewState.status = 'all'; rerender();
  }));
  const statusSel = el.querySelector('[data-f="status"]');
  if (statusSel) statusSel.addEventListener('change', () => {
    viewState.status = statusSel.value;
    if (statusSel.value !== 'all') viewState.purpose = 'all';
    rerender();
  });
  const queryIn = el.querySelector('[data-f="query"]');
  let debounce = null;
  queryIn.addEventListener('input', () => {
    viewState.query = queryIn.value;
    clearTimeout(debounce);
    debounce = setTimeout(() => { focusQueryAfterRender = true; rerender(); }, 300);
  });
  if (focusQueryAfterRender) {
    focusQueryAfterRender = false;
    queryIn.focus();
    queryIn.setSelectionRange(queryIn.value.length, queryIn.value.length);
  }

  el.querySelector('[data-act="add"]').addEventListener('click', () => openOrderForm());
  el.querySelectorAll('.order-item').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-act="status"]').addEventListener('click', () => changeStatus(id));
    row.querySelector('[data-act="detail"]').addEventListener('click', async () => {
      const o = await db.getOrder(id);
      if (o) openOrderDetail(o);
    });
  });
}

// ステータス変更(一覧から直接)
async function changeStatus(id) {
  const o = await db.getOrder(id);
  if (!o) return;
  const picked = await actionSheet(`No.${o.caseNumber} ${o.customerNameKana} 様のステータス`,
    db.ORDER_STATUSES.map(s => ({
      label: (s.id === o.status ? '✔ ' : '') + s.label,
      value: s.id,
      cls: s.id === o.status ? 'primary' : '',
    })));
  if (!picked || picked === o.status) return;
  if (picked === 's7') {
    const ok = await confirmDialog(
      'この案件を完了済みにしますか?\n\n完了済みの案件は通常一覧から非表示になります。',
      { okLabel: '完了にする' });
    if (!ok) return;
  }
  const now = new Date().toISOString();
  o.status = picked;
  o.statusUpdatedAt = now;
  o.updatedAt = now;
  await db.putOrder(o);
  toast(`「${db.statusLabel(picked)}」に変更しました`);
  rerender();
}

// 詳細表示
function openOrderDetail(o) {
  const m = openModal(`
    <div class="modal-head"><h2>No.${o.caseNumber}　${esc(o.customerNameKana)} 様</h2><button class="modal-close">✕</button></div>
    <table class="sum-table">
      <tr><th>ステータス</th><td>${db.statusLabel(o.status)}</td></tr>
      <tr><th>メモ</th><td style="white-space:pre-line">${esc(o.memo || 'なし')}</td></tr>
      <tr><th>登録日時</th><td>${fmtDateTime(o.createdAt)}</td></tr>
      <tr><th>最終更新</th><td>${fmtDateTime(o.updatedAt)}</td></tr>
      <tr><th>状態変更日時</th><td>${fmtDateTime(o.statusUpdatedAt)}</td></tr>
    </table>
    <div class="btn-row">
      <button class="btn" data-act="status">ステータス変更</button>
      <button class="btn primary" data-act="edit">編集</button>
    </div>
    <button class="btn ghost-danger block mt8" data-act="delete">この案件を削除</button>
  `);
  m.el.querySelector('[data-act="status"]').addEventListener('click', () => { m.close(); changeStatus(o.id); });
  m.el.querySelector('[data-act="edit"]').addEventListener('click', () => { m.close(); openOrderForm(o); });
  m.el.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog(
      `No.${o.caseNumber} ${o.customerNameKana} 様の案件を削除しますか?\n\n削除すると元に戻せません。完了した案件は削除ではなく「完了済み」への変更をおすすめします。`,
      { okLabel: '削除する', danger: true });
    if (!ok) return;
    await db.deleteOrder(o.id);
    m.close();
    toast('削除しました');
    rerender();
  });
}

// 登録・編集フォーム(FABからも呼ばれる)
export function openOrderForm(existing = null) {
  let dirty = false;
  const digitsOf = (caseNumber) => {
    const s = String(caseNumber ?? '');
    return s.startsWith(CASE_PREFIX) ? s.slice(CASE_PREFIX.length) : s;
  };

  const m = openModal(`
    <div class="modal-head"><h2>${existing ? '客注を編集' : '客注を登録'}</h2><button class="modal-close">✕</button></div>
    <label class="f-label">お客様の名前(カナ・必須)</label>
    <input type="text" data-f="name" placeholder="例: ヤマダ　タロウ">
    <label class="f-label">案件番号(必須・先頭100固定)</label>
    <div class="prefix-num">
      <span class="prefix">${CASE_PREFIX}</span>
      <input type="number" inputmode="numeric" min="0" data-f="caseDigits" placeholder="続きの番号">
    </div>
    <label class="f-label">メモ(任意)</label>
    <textarea data-f="memo" rows="3" placeholder="商品名、サイズ、入荷予定など"></textarea>
    ${existing ? `<label class="f-label">ステータス</label>
      <select data-f="status">${db.ORDER_STATUSES.map(s =>
        `<option value="${s.id}" ${existing.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select>` : ''}
    <div class="btn-row">
      <button class="btn primary block" data-act="save">保存</button>
    </div>
  `, {
    onBeforeClose: async () => {
      if (!dirty) return true;
      return confirmDialog('入力途中の内容を破棄しますか?', { okLabel: '破棄する', danger: true });
    },
  });

  const $ = (sel) => m.el.querySelector(sel);
  const nameIn = $('[data-f="name"]');
  const digitsIn = $('[data-f="caseDigits"]');
  nameIn.value = existing ? existing.customerNameKana : '';
  digitsIn.value = existing ? digitsOf(existing.caseNumber) : '';
  $('[data-f="memo"]').value = existing ? existing.memo : '';
  m.el.querySelectorAll('input, textarea, select').forEach(i => i.addEventListener('input', () => { dirty = true; }));

  // 半角カナはフォーカスを外れた時点で全角へ変換
  nameIn.addEventListener('blur', () => {
    const v = normalizeKanaName(nameIn.value);
    if (v !== nameIn.value) nameIn.value = v;
  });

  $('[data-act="save"]').addEventListener('click', async () => {
    const name = normalizeKanaName(nameIn.value);
    nameIn.value = name;
    if (!name) { toast('名前を入力してください'); return; }
    const digits = digitsIn.value.trim();
    if (!digits || !/^[0-9]+$/.test(digits)) { toast('案件番号の続きの数字を入力してください'); return; }
    const caseNumber = Number(CASE_PREFIX + digits);

    if (!isKatakanaOnly(name)) {
      const ok = await confirmDialog(
        `名前にカタカナ以外の文字が含まれています。\n「${name}」\nこのまま保存しますか?`,
        { okLabel: 'このまま保存' });
      if (!ok) return;
    }

    // 案件番号の重複警告(禁止はしない)
    const orders = await db.getOrders();
    const dup = orders.find(o => o.caseNumber === caseNumber && (!existing || o.id !== existing.id));
    if (dup) {
      const act = await actionSheet(
        `案件番号 ${caseNumber} は「${dup.customerNameKana} 様(${db.statusLabel(dup.status)})」で登録済みです`,
        [
          { label: '既存案件を開く', value: 'open' },
          { label: 'このまま保存する', value: 'save' },
        ]);
      if (act === 'open') { m.close(); openOrderDetail(dup); return; }
      if (act !== 'save') return;
    }

    const now = new Date().toISOString();
    let order;
    if (existing) {
      order = { ...existing, customerNameKana: name, caseNumber, memo: $('[data-f="memo"]').value, updatedAt: now };
      const newStatus = $('[data-f="status"]').value;
      if (newStatus !== existing.status) {
        if (newStatus === 's7') {
          const ok = await confirmDialog(
            'この案件を完了済みにしますか?\n\n完了済みの案件は通常一覧から非表示になります。',
            { okLabel: '完了にする' });
          if (!ok) return;
        }
        order.status = newStatus;
        order.statusUpdatedAt = now;
      }
    } else {
      order = db.newOrder({ name, caseNumber, memo: $('[data-f="memo"]').value });
    }
    await db.putOrder(order);
    m.close();
    toast('保存しました');
    rerender();
  });
}
