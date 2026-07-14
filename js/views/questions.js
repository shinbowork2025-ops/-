// お客様質問記録

import * as db from '../db.js';
import * as store from '../store.js';
import { esc, fmtTime, nowMin, slotIndexAt, uid } from '../util.js';
import { chipGroup, chipGroupMulti, confirmDialog, openModal, toast } from '../ui.js';
import { groupBlocks } from './schedule.js';

const PLACE_FIXED = ['レジ', 'サービスカウンター', '店頭', '屋外売場', '資材館', 'バックヤード付近', 'その他'];
const DEST_FIXED = ['同じ場所', 'レジ', 'サービスカウンター', '店頭', '屋外売場', '資材館', '担当者へ引継ぎ', '不明', 'その他'];
const TOOLS = ['地図', 'スマホ', 'ハンディ', 'ストコン', 'DWH', '担当者', '上司'];
const RESULTS = ['解決', '担当者へ引継ぎ', '未解決'];
const DISPLAY = [{ label: 'あり', value: 'あり' }, { label: 'なし', value: 'なし' }, { label: '未確認', value: '確認していない' }];

function placeText(type, aisle, fixed) {
  return type === 'aisle' ? `${aisle}番通路` : (fixed || '');
}

export async function render(el) {
  const daily = store.getDaily();
  const qs = [...daily.questions].sort((a, b) => (a.at < b.at ? 1 : -1));

  el.innerHTML = `
    <div class="card">
      <h3>本日の質問記録 ${qs.length}件(当日限り・翌日は集計のみ残ります)</h3>
      ${qs.length === 0 ? '<div class="muted">まだ記録がありません</div>' : qs.map(q => `
        <div class="q-item" data-id="${q.id}">
          <div class="q-head">
            <span>${fmtTime(q.at)}　${esc(placeText(q.placeType, q.placeAisle, q.placeFixed))}</span>
            <span>${esc(q.result)}・${q.minutes}分</span>
          </div>
          <div class="q-content">${esc(q.content)}</div>
          <div class="muted">案内先: ${esc(placeText(q.destType, q.destAisle, q.destFixed))}</div>
          ${q.outcome ? `<div class="muted">結末: ${esc(q.outcome)}</div>` : ''}
        </div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn primary" data-act="start-timer">🙋 お客様対応開始</button>
      <button class="btn" data-act="add">記録だけ追加</button>
    </div>`;

  el.querySelector('[data-act="start-timer"]').addEventListener('click', startCustomerTimer);
  el.querySelector('[data-act="add"]').addEventListener('click', () => openQuestionForm());
  el.querySelectorAll('.q-item').forEach(row => {
    row.addEventListener('click', () => {
      const q = store.getDaily().questions.find(x => x.id === row.dataset.id);
      if (q) openQuestionForm(null, q);
    });
  });
}

// FAB・質問画面から呼ぶ。タイマー開始のみで入力は求めない。
export async function startCustomerTimer() {
  const daily = store.getDaily();
  if (daily.activeTimer) { toast('すでに対応中のタイマーがあります(ホームで終了できます)'); return; }
  const presets = await db.getPresets();
  const idx = slotIndexAt(nowMin());
  let scheduledLabel = '';
  if (idx >= 0) {
    const b = groupBlocks(daily.schedule).find(b => b.slot !== null && b.start <= idx && idx < b.end);
    if (b) scheduledLabel = db.slotLabel(b.slot, presets);
  }
  await store.mutateDaily(d => {
    d.activeTimer = { startedAt: new Date().toISOString(), scheduledLabel };
  });
  location.hash = '#/home';
  toast('対応タイマーを開始しました');
}

// タイマーを終了して記録フォームを開く(ホームのカード・下部中央ボタン共用)
export async function endCustomerTimer() {
  const t = store.getDaily().activeTimer;
  if (!t) return;
  const minutes = Math.max(1, Math.round((Date.now() - new Date(t.startedAt).getTime()) / 60000));
  await store.mutateDaily(d => { d.activeTimer = null; });
  openQuestionForm({ at: t.startedAt, minutes });
}

// 質問記録フォーム。prefill: {at, minutes}(タイマー終了から)/ existing: 既存記録の編集
export function openQuestionForm(prefill = null, existing = null) {
  const q = existing || {
    id: uid(),
    at: (prefill && prefill.at) || new Date().toISOString(),
    placeType: 'fixed', placeAisle: '', placeFixed: '',
    content: '',
    destType: 'fixed', destAisle: '', destFixed: '',
    displayData: '確認していない',
    minutes: (prefill && prefill.minutes) || 0,
    tools: [],
    result: '解決',
    outcome: '',
  };
  let dirty = false;

  const m = openModal(`
    <div class="modal-head"><h2>${existing ? '質問記録を編集' : 'お客様質問を記録'}</h2><button class="modal-close">✕</button></div>
    <div class="notice">お客様の氏名、電話番号、住所などの個人情報は入力しないでください。</div>

    <label class="f-label">質問された場所</label>
    <div class="inline-num"><input type="number" inputmode="numeric" min="1" data-f="placeAisle"><span>番通路</span></div>
    <div class="mt8" data-f="placeFixed"></div>

    <label class="f-label">内容(必須)</label>
    <textarea data-f="content" rows="2" placeholder="例: 除草剤はどこにあるか"></textarea>

    <label class="f-label">案内した場所</label>
    <div class="inline-num"><input type="number" inputmode="numeric" min="1" data-f="destAisle"><span>番通路</span></div>
    <div class="mt8" data-f="destFixed"></div>

    <label class="f-label">陳列データ</label>
    <div data-f="display"></div>

    <label class="f-label">解決に必要だったもの(複数選択可)</label>
    <div data-f="tools"></div>

    <label class="f-label">結果</label>
    <div data-f="result"></div>

    <label class="f-label">結末(任意・自由記入)</label>
    <textarea data-f="outcome" rows="2" placeholder="例: 在庫なしのため取り寄せを案内した"></textarea>

    <label class="f-label">所要時間(分)${prefill && prefill.minutes ? '　※タイマー計測値' : ''}</label>
    <div class="inline-num"><input type="number" inputmode="numeric" min="0" data-f="minutes"><span>分</span></div>

    <div class="btn-row">
      ${existing ? '<button class="btn ghost-danger" data-act="delete">削除</button>' : ''}
      <button class="btn primary" data-act="save" style="flex:2">保存</button>
    </div>
  `, {
    onBeforeClose: async () => {
      if (!dirty && !prefill) return true;
      return confirmDialog('この記録を破棄しますか?\n(タイマーの計測値も失われます)', { okLabel: '破棄する', danger: true });
    },
  });

  const $ = (sel) => m.el.querySelector(sel);
  $('[data-f="content"]').value = q.content;
  $('[data-f="outcome"]').value = q.outcome || '';
  $('[data-f="minutes"]').value = q.minutes || '';
  const placeAisleIn = $('[data-f="placeAisle"]');
  const destAisleIn = $('[data-f="destAisle"]');
  placeAisleIn.value = q.placeType === 'aisle' ? q.placeAisle : '';
  destAisleIn.value = q.destType === 'aisle' ? q.destAisle : '';

  let placeFixed = q.placeType === 'fixed' ? q.placeFixed : null;
  let destFixed = q.destType === 'fixed' ? q.destFixed : null;
  let displayData = q.displayData;
  let result = q.result;
  const tools = new Set(q.tools || []);

  // 通路番号と定型場所は排他: 番号を入れたらチップ解除、チップを押したら番号クリア
  const placeChipBox = $('[data-f="placeFixed"]');
  const destChipBox = $('[data-f="destFixed"]');
  const renderPlaceChips = () => chipGroup(placeChipBox,
    PLACE_FIXED.map(x => ({ label: x, value: x })), placeFixed,
    v => { placeFixed = v; placeAisleIn.value = ''; dirty = true; });
  const renderDestChips = () => chipGroup(destChipBox,
    DEST_FIXED.map(x => ({ label: x, value: x })), destFixed,
    v => { destFixed = v; destAisleIn.value = ''; dirty = true; });
  renderPlaceChips();
  renderDestChips();
  placeAisleIn.addEventListener('input', () => { if (placeAisleIn.value) { placeFixed = null; renderPlaceChips(); } dirty = true; });
  destAisleIn.addEventListener('input', () => { if (destAisleIn.value) { destFixed = null; renderDestChips(); } dirty = true; });

  chipGroup($('[data-f="display"]'), DISPLAY, displayData, v => { displayData = v; dirty = true; });
  chipGroupMulti($('[data-f="tools"]'), TOOLS.map(x => ({ label: x, value: x })), tools, () => { dirty = true; });
  chipGroup($('[data-f="result"]'), RESULTS.map(x => ({ label: x, value: x })), result, v => { result = v; dirty = true; });

  m.el.querySelectorAll('textarea, input').forEach(i => i.addEventListener('input', () => { dirty = true; }));

  $('[data-act="save"]').addEventListener('click', async () => {
    const content = $('[data-f="content"]').value.trim();
    if (!content) { toast('内容を入力してください'); return; }
    const pa = placeAisleIn.value.trim();
    const da = destAisleIn.value.trim();
    q.content = content;
    q.placeType = pa ? 'aisle' : 'fixed';
    q.placeAisle = pa;
    q.placeFixed = pa ? '' : (placeFixed || 'その他');
    q.destType = da ? 'aisle' : 'fixed';
    q.destAisle = da;
    q.destFixed = da ? '' : (destFixed || '不明');
    q.displayData = displayData;
    q.tools = [...tools];
    q.result = result;
    q.outcome = $('[data-f="outcome"]').value.trim();
    q.minutes = Math.max(0, Math.round(Number($('[data-f="minutes"]').value) || 0));
    await store.mutateDaily(d => {
      const i = d.questions.findIndex(x => x.id === q.id);
      if (i >= 0) d.questions[i] = q; else d.questions.push(q);
    });
    m.close();
    toast('保存しました');
  });

  const delBtn = $('[data-act="delete"]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!await confirmDialog('この記録を削除しますか?', { okLabel: '削除する', danger: true })) return;
    await store.mutateDaily(d => { d.questions = d.questions.filter(x => x.id !== q.id); });
    m.close();
  });
}
