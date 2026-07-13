// IndexedDB アクセスと日次締め処理・集計・バックアップ

import { SLOT_COUNT, SLOT_MIN, todayStr, uid } from './util.js';

export const APP_ID = 'store-work-note';
export const SCHEMA_VERSION = 1;

const DB_NAME = 'store-work-note';
const DB_VER = 1;
const STORES = ['daily', 'summaries', 'orders', 'kv'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('daily')) d.createObjectStore('daily', { keyPath: 'date' });
      if (!d.objectStoreNames.contains('summaries')) d.createObjectStore('summaries', { keyPath: 'date' });
      if (!d.objectStoreNames.contains('orders')) d.createObjectStore('orders', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function op(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const get = (store, key) => op(store, 'readonly', s => s.get(key));
const getAll = (store) => op(store, 'readonly', s => s.getAll());
const put = (store, value) => op(store, 'readwrite', s => s.put(value));
const del = (store, key) => op(store, 'readwrite', s => s.delete(key));
const clear = (store) => op(store, 'readwrite', s => s.clear());

// ---- kv ----

export async function getKV(key, fallback = null) {
  const row = await get('kv', key);
  return row ? row.value : fallback;
}
export function putKV(key, value) { return put('kv', { key, value }); }

// ---- プリセット ----

export const DEFAULT_PRESETS = [
  { id: 'p-reji',    name: 'レジ',             color: '#2563eb', visible: true },
  { id: 'p-hiru',    name: '昼休憩',           color: '#f59e0b', visible: true },
  { id: 'p-kokyu',   name: '小休憩',           color: '#fbbf24', visible: true },
  { id: 'p-shina',   name: '品出し',           color: '#16a34a', visible: true },
  { id: 'p-maedashi',name: '前出し・売場整理', color: '#0d9488', visible: true },
  { id: 'p-hachu',   name: '発注',             color: '#7c3aed', visible: true },
  { id: 'p-seiso',   name: '清掃',             color: '#64748b', visible: true },
  { id: 'p-kaiten',  name: '開店準備',         color: '#db2777', visible: true },
  { id: 'p-heiten',  name: '閉店作業',         color: '#475569', visible: true },
];

export async function getPresets() {
  let p = await getKV('presets');
  if (!p) { p = structuredClone(DEFAULT_PRESETS); await putKV('presets', p); }
  return p;
}
export function savePresets(p) { return putKV('presets', p); }

export async function getTemplates() { return (await getKV('templates')) || []; }
export function saveTemplates(t) { return putKV('templates', t); }

export async function getMeta() {
  return (await getKV('meta')) || { lastUsedDate: null, lastBackupAt: null };
}
export function saveMeta(m) { return putKV('meta', m); }

// ---- 当日データ ----

export function emptyDaily(date) {
  return {
    date,
    schedule: Array(SLOT_COUNT).fill(null), // null | {p:presetId} | {t:'自由記入テキスト'}
    todos: [],       // {id, text, deadlineType:'none'|'time'|'endOfDay', deadlineTime, priority:'normal'|'urgent', status:'todo'|'doing'|'done', aisle, createdAt}
    questions: [],   // {id, at, placeType, placeAisle, placeFixed, content, destType, destAisle, destFixed, displayData, minutes, tools:[], result}
    activeTimer: null, // {startedAt, scheduledLabel}
  };
}

export const getDaily = (date) => get('daily', date);
export const putDaily = (d) => put('daily', d);
export const deleteDaily = (date) => del('daily', date);

// ---- 日次集計 ----

export const getSummaries = () => getAll('summaries');
export const putSummary = (s) => put('summaries', s);
export const deleteSummary = (date) => del('summaries', date);

export function slotLabel(slot, presets) {
  if (!slot) return null;
  if (slot.t !== undefined) return slot.t;
  const p = presets.find(x => x.id === slot.p);
  return p ? p.name : '(削除済み項目)';
}

export function computeSummary(daily, presets) {
  // スケジュール
  const byItem = {};
  let filled = 0;
  for (const slot of daily.schedule) {
    const label = slotLabel(slot, presets);
    if (label === null) continue;
    byItem[label] = (byItem[label] || 0) + SLOT_MIN;
    filled += SLOT_MIN;
  }

  // TODO
  const todos = daily.todos;
  const todoSummary = {
    total: todos.length,
    done: todos.filter(t => t.status === 'done').length,
    notDone: todos.filter(t => t.status !== 'done').length,
    urgent: todos.filter(t => t.priority === 'urgent').length,
  };

  // お客様質問
  const qs = daily.questions;
  const count = (arr, keyFn) => {
    const o = {};
    for (const q of arr) {
      const k = keyFn(q);
      if (k == null) continue;
      o[k] = (o[k] || 0) + 1;
    }
    return o;
  };
  const placeKey = (type, aisle, fixed) =>
    type === 'aisle' ? `${aisle}番通路` : (fixed || 'その他');
  const totalMin = qs.reduce((a, q) => a + (q.minutes || 0), 0);
  const byTool = {};
  for (const q of qs) for (const t of (q.tools || [])) byTool[t] = (byTool[t] || 0) + 1;

  const questionSummary = {
    total: qs.length,
    resolved: qs.filter(q => q.result === '解決').length,
    handoff: qs.filter(q => q.result === '担当者へ引継ぎ').length,
    unresolved: qs.filter(q => q.result === '未解決').length,
    totalMin,
    avgMin: qs.length ? Math.round(totalMin / qs.length * 10) / 10 : 0,
    maxMin: qs.length ? Math.max(...qs.map(q => q.minutes || 0)) : 0,
    byPlace: count(qs, q => placeKey(q.placeType, q.placeAisle, q.placeFixed)),
    byDest: count(qs, q => placeKey(q.destType, q.destAisle, q.destFixed)),
    byDisplay: count(qs, q => q.displayData),
    byTool,
    byHour: count(qs, q => `${new Date(q.at).getHours()}時台`),
  };

  return {
    date: daily.date,
    schedule: { byItem, filledMinutes: filled, emptyMinutes: SLOT_COUNT * SLOT_MIN - filled },
    todo: todoSummary,
    questions: questionSummary,
    createdAt: new Date().toISOString(),
  };
}

// 指定日の日次データを締めて集計へ変換する
async function closeDay(date) {
  const old = await getDaily(date);
  if (old) {
    const presets = await getPresets();
    await putSummary(computeSummary(old, presets));
    await deleteDaily(date);
  }
}

// 日付変更の検出と締め処理。起動時・再表示時・書き込み前に呼ぶ。
// 返り値: { daily, closedDate, clockBack }
export async function ensureToday() {
  const today = todayStr();
  const meta = await getMeta();
  let closedDate = null;
  let clockBack = false;

  if (meta.lastUsedDate && meta.lastUsedDate < today) {
    await closeDay(meta.lastUsedDate);
    closedDate = meta.lastUsedDate;
  } else if (meta.lastUsedDate && meta.lastUsedDate > today) {
    // 端末時計の巻き戻り。未来日のデータには触らず警告だけ返す。
    clockBack = true;
  }

  if (meta.lastUsedDate !== today) {
    meta.lastUsedDate = today;
    await saveMeta(meta);
  }

  let daily = await getDaily(today);
  if (!daily) {
    daily = emptyDaily(today);
    await putDaily(daily);
  }
  return { daily, closedDate, clockBack };
}

// ---- 客注 ----

export const ORDER_STATUSES = [
  { id: 's1', label: '未発注未連絡' },
  { id: 's2', label: '未発注連絡済み' },
  { id: 's3', label: '発注済み' },
  { id: 's4', label: '入荷未連絡' },
  { id: 's5', label: '入荷連絡済み' },
  { id: 's6', label: '引渡し済み' },
  { id: 's7', label: '完了済み' },
];

export const ORDER_PURPOSE_FILTERS = [
  { id: 'all',      label: 'すべて',     statuses: ['s1', 's2', 's3', 's4', 's5', 's6'] },
  { id: 'toOrder',  label: '要発注',     statuses: ['s1', 's2'] },
  { id: 'ordered',  label: '発注後',     statuses: ['s3'] },
  { id: 'toCall',   label: '要連絡',     statuses: ['s4'] },
  { id: 'called',   label: '連絡済み',   statuses: ['s5'] },
  { id: 'handed',   label: '引渡し済み', statuses: ['s6'] },
];

export function statusLabel(id) {
  const s = ORDER_STATUSES.find(x => x.id === id);
  return s ? s.label : id;
}

export const getOrders = () => getAll('orders');
export const getOrder = (id) => get('orders', id);
export const putOrder = (o) => put('orders', o);
export const deleteOrder = (id) => del('orders', id);

export function newOrder({ name, caseNumber, memo }) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    customerNameKana: name,
    caseNumber,           // 数値(先頭100固定+入力桁)
    memo: memo || '',
    status: 's1',
    createdAt: now,
    updatedAt: now,
    statusUpdatedAt: now,
  };
}

// ---- バックアップ ----

export async function exportBackup() {
  const meta = await getMeta();
  const [orders, summaries, daily] = await Promise.all([
    getOrders(), getSummaries(),
    meta.lastUsedDate ? getDaily(meta.lastUsedDate) : null,
  ]);
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      orders,
      summaries,
      presets: await getPresets(),
      templates: await getTemplates(),
      meta,
      daily: daily || null,
    },
  };
}

// 不正なら文字列(エラー理由)、正常なら null
export function validateBackup(obj) {
  if (!obj || typeof obj !== 'object') return 'JSONの形式が不正です';
  if (obj.app !== APP_ID) return 'このアプリのバックアップファイルではありません';
  if (!Number.isInteger(obj.schemaVersion)) return 'schemaVersion がありません';
  if (obj.schemaVersion > SCHEMA_VERSION) return '新しいバージョンのバックアップのため読み込めません';
  const d = obj.data;
  if (!d || typeof d !== 'object') return 'データ本体がありません';
  if (!Array.isArray(d.orders) || !Array.isArray(d.summaries)) return '客注または集計データが不正です';
  return null;
}

// 全上書き復元。復元後に ensureToday を呼ぶこと(過去日の当日データは締め処理される)。
export async function importBackup(obj) {
  for (const s of STORES) await clear(s);
  const d = obj.data;
  for (const o of d.orders) await put('orders', o);
  for (const s of d.summaries) await put('summaries', s);
  if (d.presets) await putKV('presets', d.presets);
  if (d.templates) await putKV('templates', d.templates);
  if (d.meta) await putKV('meta', d.meta);
  if (d.daily && d.daily.date) await put('daily', d.daily);
}

// 全データ削除(設定画面用)
export async function wipeAll() {
  for (const s of STORES) await clear(s);
}
