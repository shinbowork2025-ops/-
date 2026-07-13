// 当日データの共有状態。全ての書き込みは mutateDaily を通す。
// mutateDaily は書き込み前に必ず ensureToday を呼ぶため、
// 0時をまたいだ後の最初の操作が前日データへ書き込まれることはない。

import * as db from './db.js';
import { toast } from './ui.js';

let daily = null;
let persisted = null; // navigator.storage.persist() の結果
const listeners = new Set();

export function onChange(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn(); }

export function getDaily() { return daily; }
export function isPersisted() { return persisted; }
export function setPersisted(v) { persisted = v; }

export async function init() {
  const r = await db.ensureToday();
  daily = r.daily;
  return r;
}

// 日付変更チェック(表示時・visibilitychange時)。締めが起きたら true。
export async function refreshDay({ silent = false } = {}) {
  const r = await db.ensureToday();
  const changed = !daily || daily.date !== r.daily.date;
  daily = r.daily;
  if (r.closedDate && !silent) {
    toast(`日付が変わったため ${r.closedDate} の記録を集計しました`);
  }
  if (r.clockBack && !silent) {
    toast('端末の日付が過去に戻っています。記録日に注意してください', 4000);
  }
  if (changed) emit();
  return r;
}

// 当日データを変更して保存する。fn(daily) 内で直接書き換える。
export async function mutateDaily(fn) {
  const r = await db.ensureToday();
  daily = r.daily;
  fn(daily);
  await db.putDaily(daily);
  emit();
  return daily;
}

// 復元・全削除の後に呼ぶ
export async function reloadAll() {
  const r = await db.ensureToday();
  daily = r.daily;
  emit();
  return r;
}
