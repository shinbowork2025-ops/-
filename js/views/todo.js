// 当日TODO

import * as store from '../store.js';
import { esc, uid } from '../util.js';
import { confirmDialog, openModal, chipGroup, toast } from '../ui.js';

const STATUS_LABEL = { todo: '未着手', doing: '対応中', done: '完了' };
const NEXT_STATUS = { todo: 'doing', doing: 'done', done: 'todo' };

function deadlineLabel(t) {
  if (t.deadlineType === 'time') return `〜${t.deadlineTime}`;
  if (t.deadlineType === 'endOfDay') return '退勤まで';
  return '';
}

// 並び順: 急ぎ → 時刻指定(早い順) → 退勤まで → 期限なし
function sortKey(t) {
  const urgent = t.priority === 'urgent' ? 0 : 1;
  let dl = 2, time = '99:99';
  if (t.deadlineType === 'time' && t.deadlineTime) { dl = 0; time = t.deadlineTime; }
  else if (t.deadlineType === 'endOfDay') dl = 1;
  return [urgent, dl, time, t.createdAt];
}

function cmp(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

export async function render(el) {
  const daily = store.getDaily();
  const open = daily.todos.filter(t => t.status !== 'done').sort(cmp);
  const done = daily.todos.filter(t => t.status === 'done');

  const item = (t) => `
    <div class="todo-item" data-id="${t.id}">
      <button class="todo-check ${t.status === 'done' ? 'done' : ''}" data-act="toggle" title="完了切替">
        ${t.status === 'done' ? '✔' : ''}
      </button>
      <div class="todo-main" data-act="edit">
        <div class="todo-text ${t.status === 'done' ? 'done' : ''}">${esc(t.text)}</div>
        <div class="todo-meta">
          ${t.priority === 'urgent' ? '<span class="tag urgent">急ぎ</span>' : ''}
          ${t.status === 'doing' ? '<span class="tag doing">対応中</span>' : ''}
          ${deadlineLabel(t) ? `<span class="tag">${esc(deadlineLabel(t))}</span>` : ''}
          ${t.aisle ? `<span class="tag">${esc(t.aisle)}番通路</span>` : ''}
        </div>
      </div>
      <button class="btn small" data-act="status">${STATUS_LABEL[t.status]}</button>
    </div>`;

  el.innerHTML = `
    <div class="card">
      <h3>本日のTODO(当日限り・翌日に自動消去)</h3>
      ${open.length === 0 ? '<div class="muted">未完了のTODOはありません</div>' : open.map(item).join('')}
    </div>
    ${done.length ? `
      <details class="done-fold card" style="padding:0 14px">
        <summary>完了済み ${done.length}件</summary>
        ${done.map(item).join('')}
      </details>` : ''}
    <button class="btn primary block" data-act="add">＋ TODOを追加</button>`;

  el.querySelector('[data-act="add"]').addEventListener('click', () => openTodoForm());

  el.querySelectorAll('.todo-item').forEach(row => {
    const id = row.dataset.id;
    const find = () => store.getDaily().todos.find(t => t.id === id);
    row.querySelector('[data-act="toggle"]').addEventListener('click', () => {
      store.mutateDaily(d => {
        const t = d.todos.find(x => x.id === id);
        if (t) t.status = t.status === 'done' ? 'todo' : 'done';
      });
    });
    row.querySelector('[data-act="status"]').addEventListener('click', () => {
      store.mutateDaily(d => {
        const t = d.todos.find(x => x.id === id);
        if (t) t.status = NEXT_STATUS[t.status];
      });
    });
    row.querySelector('[data-act="edit"]').addEventListener('click', () => {
      const t = find();
      if (t) openTodoForm(t);
    });
  });
}

// 追加・編集フォーム(FABからも呼ばれる)
export function openTodoForm(existing = null) {
  const t = existing || {
    id: uid(), text: '', deadlineType: 'none', deadlineTime: '',
    priority: 'normal', status: 'todo', aisle: '', createdAt: new Date().toISOString(),
  };
  let dirty = false;

  const m = openModal(`
    <div class="modal-head"><h2>${existing ? 'TODOを編集' : 'TODOを追加'}</h2><button class="modal-close">✕</button></div>
    <label class="f-label">内容(必須)</label>
    <textarea data-f="text" rows="2" placeholder="例: 3番通路の補充"></textarea>
    <label class="f-label">優先度</label>
    <div data-f="priority"></div>
    <label class="f-label">期限</label>
    <div data-f="deadline"></div>
    <input type="time" data-f="deadlineTime" class="mt8 hidden">
    <label class="f-label">状態</label>
    <div data-f="status"></div>
    <label class="f-label">関連通路(任意)</label>
    <div class="inline-num"><input type="number" inputmode="numeric" min="1" data-f="aisle"><span>番通路</span></div>
    <div class="btn-row">
      ${existing ? '<button class="btn ghost-danger" data-act="delete">削除</button>' : ''}
      <button class="btn primary" data-act="save" style="flex:2">保存</button>
    </div>
  `, {
    onBeforeClose: async () => {
      if (!dirty) return true;
      return confirmDialog('入力途中の内容を破棄しますか?', { okLabel: '破棄する', danger: true });
    },
  });

  const $ = (sel) => m.el.querySelector(sel);
  $('[data-f="text"]').value = t.text;
  $('[data-f="aisle"]').value = t.aisle || '';
  const timeInput = $('[data-f="deadlineTime"]');
  timeInput.value = t.deadlineTime || '';
  timeInput.classList.toggle('hidden', t.deadlineType !== 'time');

  let priority = t.priority, deadlineType = t.deadlineType, status = t.status;
  chipGroup($('[data-f="priority"]'),
    [{ label: '通常', value: 'normal' }, { label: '急ぎ', value: 'urgent' }],
    priority, v => { priority = v; dirty = true; });
  chipGroup($('[data-f="deadline"]'),
    [{ label: 'なし', value: 'none' }, { label: '時刻指定', value: 'time' }, { label: '退勤まで', value: 'endOfDay' }],
    deadlineType, v => {
      deadlineType = v; dirty = true;
      timeInput.classList.toggle('hidden', v !== 'time');
    });
  chipGroup($('[data-f="status"]'),
    [{ label: '未着手', value: 'todo' }, { label: '対応中', value: 'doing' }, { label: '完了', value: 'done' }],
    status, v => { status = v; dirty = true; });

  m.el.querySelectorAll('textarea, input').forEach(i => i.addEventListener('input', () => { dirty = true; }));

  $('[data-act="save"]').addEventListener('click', async () => {
    const text = $('[data-f="text"]').value.trim();
    if (!text) { toast('内容を入力してください'); return; }
    t.text = text;
    t.priority = priority;
    t.deadlineType = deadlineType;
    t.deadlineTime = deadlineType === 'time' ? timeInput.value : '';
    t.status = status;
    t.aisle = $('[data-f="aisle"]').value.trim();
    await store.mutateDaily(d => {
      const i = d.todos.findIndex(x => x.id === t.id);
      if (i >= 0) d.todos[i] = t; else d.todos.push(t);
    });
    m.close();
    toast('保存しました');
  });

  const delBtn = $('[data-act="delete"]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!await confirmDialog('このTODOを削除しますか?', { okLabel: '削除する', danger: true })) return;
    await store.mutateDaily(d => { d.todos = d.todos.filter(x => x.id !== t.id); });
    m.close();
  });
}
