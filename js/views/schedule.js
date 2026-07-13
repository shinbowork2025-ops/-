// スケジュール画面(縦型タイムライン表示 + ペイント編集)

import * as db from '../db.js';
import * as store from '../store.js';
import { SLOT_COUNT, esc, minToLabel, nowMin, slotStartMin, uid } from '../util.js';
import { actionSheet, confirmDialog, toast } from '../ui.js';

// 連続する同じ予定をブロックへまとめる。end は排他的インデックス。
export function groupBlocks(schedule) {
  const blocks = [];
  let i = 0;
  while (i < SLOT_COUNT) {
    const slot = schedule[i];
    let j = i + 1;
    while (j < SLOT_COUNT && slotEq(schedule[j], slot)) j++;
    blocks.push({ start: i, end: j, slot });
    i = j;
  }
  return blocks;
}

function slotEq(a, b) {
  if (a === null || b === null) return a === b;
  if (a.p !== undefined) return b.p === a.p;
  return b.t !== undefined && b.t === a.t;
}

function slotColor(slot, presets) {
  if (!slot) return null;
  if (slot.t !== undefined) return '#8a5a2b'; // 自由記入
  const p = presets.find(x => x.id === slot.p);
  return p ? p.color : '#94a3b8';
}

// ---- 画面状態(再描画をまたいで保持) ----
let mode = 'view';               // 'view' | 'edit'
let selectedTool = null;         // {type:'preset',id} | {type:'erase'} | {type:'free'}
let undoStack = [];
let redoStack = [];

export function resetMode() { mode = 'view'; undoStack = []; redoStack = []; }

export async function render(el) {
  const daily = store.getDaily();
  const presets = await db.getPresets();
  if (mode === 'edit') renderEdit(el, daily, presets);
  else renderView(el, daily, presets);
}

// ---------- 表示モード ----------

function renderView(el, daily, presets) {
  const blocks = groupBlocks(daily.schedule);
  const isEmpty = daily.schedule.every(s => s === null);

  let rows = '';
  for (const b of blocks) {
    for (let i = b.start; i < b.end; i++) {
      const min = slotStartMin(i);
      const isHour = min % 60 === 0;
      const timeLabel = (isHour || i === 0) ? minToLabel(min) : '';
      const color = slotColor(b.slot, presets);
      let cellCls = 'tl-cell';
      let cellStyle = '';
      let label = '';
      if (b.slot) {
        cellStyle = `background:${color};`;
        if (b.end - b.start === 1) cellCls += ' tl-block-single';
        else if (i === b.start) cellCls += ' tl-block-start';
        else if (i === b.end - 1) cellCls += ' tl-block-end';
        if (i === b.start) label = `${esc(db.slotLabel(b.slot, presets))}　<span style="font-weight:400;font-size:11px">${minToLabel(slotStartMin(b.start))}〜${minToLabel(slotStartMin(b.end))}</span>`;
      } else {
        cellCls += ' empty';
      }
      rows += `<div class="tl-row ${isHour ? 'hour' : ''}" data-slot="${i}">
        <div class="tl-time">${timeLabel}</div>
        <div class="${cellCls}" style="${cellStyle}">${label}</div>
      </div>`;
    }
  }

  el.innerHTML = `
    <div class="sch-toolbar">
      <button class="btn primary" data-act="edit" style="flex:1">✏️ 編集</button>
      ${isEmpty ? '<button class="btn" data-act="template" style="flex:1">📋 テンプレート適用</button>' : ''}
    </div>
    <div class="timeline">${rows}</div>`;

  el.querySelector('[data-act="edit"]').addEventListener('click', () => {
    mode = 'edit'; undoStack = []; redoStack = [];
    render(el);
  });
  const tplBtn = el.querySelector('[data-act="template"]');
  if (tplBtn) tplBtn.addEventListener('click', () => applyTemplate(el));

  // 現在時刻ライン
  const now = nowMin();
  const rowEl = el.querySelector(`.tl-row[data-slot="${Math.floor((now - slotStartMin(0)) / 15)}"]`);
  if (rowEl && now >= slotStartMin(0) && now < slotStartMin(SLOT_COUNT)) {
    const frac = ((now - slotStartMin(0)) % 15) / 15;
    const line = document.createElement('div');
    line.className = 'now-line';
    line.style.top = `${rowEl.offsetTop + rowEl.offsetHeight * frac}px`;
    line.innerHTML = `<span>現在 ${minToLabel(now)}</span>`;
    el.querySelector('.timeline').appendChild(line);
  }
}

// ---------- 編集モード ----------

function renderEdit(el, daily, presets) {
  const visible = presets.filter(p => p.visible);
  const toolChips = visible.map(p => `
    <button class="chip tool" data-tool="preset" data-id="${p.id}">
      <span class="tool-color" style="background:${p.color}"></span>${esc(p.name)}
    </button>`).join('') + `
    <button class="chip tool" data-tool="free">✎ 自由記入</button>
    <button class="chip tool" data-tool="erase">🧽 消去</button>`;

  let rows = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const min = slotStartMin(i);
    const isHour = min % 60 === 0;
    rows += `<div class="pg-row ${isHour ? 'hour' : ''}">
      <div class="pg-time">${minToLabel(min)}</div>
      <div class="pg-cell" data-slot="${i}"></div>
    </div>`;
  }

  el.innerHTML = `
    <div class="edit-actions">
      <button class="btn small" data-act="undo">↩ 元に戻す</button>
      <button class="btn small" data-act="redo">↪ やり直す</button>
      <button class="btn small ghost-danger" data-act="clear">全消去</button>
      <button class="btn small" data-act="tpl-save">テンプレ保存</button>
      <button class="btn small" data-act="tpl-apply">テンプレ適用</button>
      <button class="btn small primary" data-act="done" style="margin-left:auto">完了</button>
    </div>
    <div class="paint-tools">${toolChips}</div>
    <div class="muted" style="margin:4px 0 8px">項目を選んでマスをタップ、またはなぞって入力</div>
    <div class="paint-grid">${rows}</div>`;

  const slots = daily.schedule;

  const paintCells = () => {
    el.querySelectorAll('.pg-cell').forEach(cell => {
      const i = Number(cell.dataset.slot);
      const s = slots[i];
      if (s) {
        cell.style.background = slotColor(s, presets);
        cell.textContent = db.slotLabel(s, presets);
        cell.classList.remove('empty');
      } else {
        cell.style.background = '';
        cell.textContent = '';
        cell.classList.add('empty');
      }
    });
    el.querySelector('[data-act="undo"]').disabled = undoStack.length === 0;
    el.querySelector('[data-act="redo"]').disabled = redoStack.length === 0;
  };
  paintCells();

  // ツール選択
  const selectToolBtn = (btn) => {
    el.querySelectorAll('.chip.tool').forEach(c => c.classList.remove('on'));
    if (btn) btn.classList.add('on');
  };
  el.querySelectorAll('.chip.tool').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tool;
      selectedTool = t === 'preset' ? { type: 'preset', id: btn.dataset.id } : { type: t };
      selectToolBtn(btn);
    });
  });
  // 前回選択の復元
  if (selectedTool) {
    const sel = selectedTool.type === 'preset'
      ? el.querySelector(`.chip.tool[data-id="${selectedTool.id}"]`)
      : el.querySelector(`.chip.tool[data-tool="${selectedTool.type}"]`);
    if (sel) selectToolBtn(sel); else selectedTool = null;
  }

  const commit = async () => {
    await store.mutateDaily(d => { d.schedule = slots.slice(); });
  };

  const applyToSlot = (i, value) => {
    if (slotEq(slots[i], value)) return false;
    slots[i] = value;
    return true;
  };

  // ペイント操作
  const grid = el.querySelector('.paint-grid');
  let painting = false;
  let snapshot = null;
  let changed = false;

  const toolValue = () => {
    if (!selectedTool) return undefined;
    if (selectedTool.type === 'preset') return { p: selectedTool.id };
    if (selectedTool.type === 'erase') return null;
    return undefined; // free は個別処理
  };

  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.pg-cell');
    if (!cell) return;
    const i = Number(cell.dataset.slot);
    if (!selectedTool) { toast('先に上の項目を選んでください'); return; }

    if (selectedTool.type === 'free') {
      const cur = slots[i];
      const text = window.prompt('内容を入力', cur && cur.t !== undefined ? cur.t : '');
      if (text === null) return;
      const v = text.trim() === '' ? null : { t: text.trim() };
      snapshot = slots.slice();
      if (applyToSlot(i, v)) {
        undoStack.push(snapshot); redoStack = [];
        paintCells(); commit();
      }
      return;
    }

    painting = true;
    changed = false;
    snapshot = slots.slice();
    grid.setPointerCapture(e.pointerId);
    if (applyToSlot(i, toolValue())) changed = true;
    paintCells();
    e.preventDefault();
  });

  grid.addEventListener('pointermove', (e) => {
    if (!painting) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const cell = t && t.closest ? t.closest('.pg-cell') : null;
    if (!cell) return;
    if (applyToSlot(Number(cell.dataset.slot), toolValue())) {
      changed = true;
      paintCells();
    }
  });

  const endPaint = () => {
    if (!painting) return;
    painting = false;
    if (changed) {
      undoStack.push(snapshot);
      redoStack = [];
      commit();
    }
    snapshot = null;
  };
  grid.addEventListener('pointerup', endPaint);
  grid.addEventListener('pointercancel', endPaint);

  // アクション
  el.querySelector('[data-act="undo"]').addEventListener('click', () => {
    if (!undoStack.length) return;
    redoStack.push(slots.slice());
    const prev = undoStack.pop();
    for (let i = 0; i < SLOT_COUNT; i++) slots[i] = prev[i];
    paintCells(); commit();
  });
  el.querySelector('[data-act="redo"]').addEventListener('click', () => {
    if (!redoStack.length) return;
    undoStack.push(slots.slice());
    const next = redoStack.pop();
    for (let i = 0; i < SLOT_COUNT; i++) slots[i] = next[i];
    paintCells(); commit();
  });
  el.querySelector('[data-act="clear"]').addEventListener('click', async () => {
    if (!await confirmDialog('スケジュールを全消去しますか?', { okLabel: '全消去', danger: true })) return;
    undoStack.push(slots.slice()); redoStack = [];
    for (let i = 0; i < SLOT_COUNT; i++) slots[i] = null;
    paintCells(); commit();
  });
  el.querySelector('[data-act="tpl-save"]').addEventListener('click', async () => {
    const name = window.prompt('テンプレート名(例: 早番)');
    if (!name || !name.trim()) return;
    const templates = await db.getTemplates();
    templates.push({ id: uid(), name: name.trim(), slots: slots.slice() });
    await db.saveTemplates(templates);
    toast('テンプレートを保存しました');
  });
  el.querySelector('[data-act="tpl-apply"]').addEventListener('click', () => applyTemplate(el, slots, () => {
    undoStack.push(slots.slice()); redoStack = [];
  }));
  el.querySelector('[data-act="done"]').addEventListener('click', () => {
    mode = 'view';
    render(el);
  });
}

// テンプレート適用(表示モード・編集モード共用)
async function applyTemplate(el, workingSlots = null, beforeApply = null) {
  const templates = await db.getTemplates();
  if (templates.length === 0) { toast('テンプレートがありません(編集画面の「テンプレ保存」で作成)'); return; }
  const id = await actionSheet('テンプレートを適用', templates.map(t => ({ label: t.name, value: t.id })));
  if (!id) return;
  const tpl = templates.find(t => t.id === id);
  const daily = store.getDaily();
  const hasContent = daily.schedule.some(s => s !== null);
  if (hasContent && !await confirmDialog('現在のスケジュールを上書きしますか?', { okLabel: '上書きする' })) return;

  if (beforeApply) beforeApply();
  if (workingSlots) {
    for (let i = 0; i < SLOT_COUNT; i++) workingSlots[i] = tpl.slots[i] ?? null;
    await store.mutateDaily(d => { d.schedule = workingSlots.slice(); });
  } else {
    await store.mutateDaily(d => { d.schedule = tpl.slots.slice(0, SLOT_COUNT); });
  }
  toast(`「${tpl.name}」を適用しました`);
}
