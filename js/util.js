// 時刻・文字列などの共通ユーティリティ

export const DAY_START = 6 * 60 + 45;   // 6:45
export const DAY_END = 20 * 60 + 15;    // 20:15
export const SLOT_MIN = 15;
export const SLOT_COUNT = (DAY_END - DAY_START) / SLOT_MIN; // 54

export function pad2(n) { return String(n).padStart(2, '0'); }

export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function nowMin() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function minToLabel(m) {
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`;
}

export function slotStartMin(i) { return DAY_START + i * SLOT_MIN; }

// 営業時間外は -1
export function slotIndexAt(min) {
  if (min < DAY_START || min >= DAY_END) return -1;
  return Math.floor((min - DAY_START) / SLOT_MIN);
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad2(d.getMinutes())}`;
}

export function fmtTime(iso) {
  const d = new Date(iso);
  return `${d.getHours()}:${pad2(d.getMinutes())}`;
}

export function fmtDateJa(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
  return `${y}年${m}月${d}日(${w})`;
}

export function uid() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// ---- カナ処理 ----

const HALF_KANA_MAP = {
  'ｶﾞ':'ガ','ｷﾞ':'ギ','ｸﾞ':'グ','ｹﾞ':'ゲ','ｺﾞ':'ゴ',
  'ｻﾞ':'ザ','ｼﾞ':'ジ','ｽﾞ':'ズ','ｾﾞ':'ゼ','ｿﾞ':'ゾ',
  'ﾀﾞ':'ダ','ﾁﾞ':'ヂ','ﾂﾞ':'ヅ','ﾃﾞ':'デ','ﾄﾞ':'ド',
  'ﾊﾞ':'バ','ﾋﾞ':'ビ','ﾌﾞ':'ブ','ﾍﾞ':'ベ','ﾎﾞ':'ボ',
  'ﾊﾟ':'パ','ﾋﾟ':'ピ','ﾌﾟ':'プ','ﾍﾟ':'ペ','ﾎﾟ':'ポ',
  'ｳﾞ':'ヴ',
  'ｱ':'ア','ｲ':'イ','ｳ':'ウ','ｴ':'エ','ｵ':'オ',
  'ｶ':'カ','ｷ':'キ','ｸ':'ク','ｹ':'ケ','ｺ':'コ',
  'ｻ':'サ','ｼ':'シ','ｽ':'ス','ｾ':'セ','ｿ':'ソ',
  'ﾀ':'タ','ﾁ':'チ','ﾂ':'ツ','ﾃ':'テ','ﾄ':'ト',
  'ﾅ':'ナ','ﾆ':'ニ','ﾇ':'ヌ','ﾈ':'ネ','ﾉ':'ノ',
  'ﾊ':'ハ','ﾋ':'ヒ','ﾌ':'フ','ﾍ':'ヘ','ﾎ':'ホ',
  'ﾏ':'マ','ﾐ':'ミ','ﾑ':'ム','ﾒ':'メ','ﾓ':'モ',
  'ﾔ':'ヤ','ﾕ':'ユ','ﾖ':'ヨ',
  'ﾗ':'ラ','ﾘ':'リ','ﾙ':'ル','ﾚ':'レ','ﾛ':'ロ',
  'ﾜ':'ワ','ｦ':'ヲ','ﾝ':'ン',
  'ｧ':'ァ','ｨ':'ィ','ｩ':'ゥ','ｪ':'ェ','ｫ':'ォ',
  'ｬ':'ャ','ｭ':'ュ','ｮ':'ョ','ｯ':'ッ',
  'ｰ':'ー','ｦﾞ':'ヲ','｡':'。','､':'、','･':'・',
};

// 半角カナ→全角カナ(濁点結合含む)、前後空白除去、半角空白→全角空白
export function normalizeKanaName(s) {
  let out = '';
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    const two = str.slice(i, i + 2);
    if (HALF_KANA_MAP[two]) { out += HALF_KANA_MAP[two]; i++; continue; }
    const one = str[i];
    out += HALF_KANA_MAP[one] ?? one;
  }
  out = out.replace(/ /g, '　');
  // 前後の空白(全角含む)を除去、連続空白は1つに
  out = out.replace(/^[\s　]+|[\s　]+$/g, '').replace(/[\s　]{2,}/g, '　');
  return out;
}

// 全角カタカナ+長音・中点・全角空白のみか
export function isKatakanaOnly(s) {
  return /^[ァ-ヺー・　]+$/.test(s);
}

// ---- CSV ----

export function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

export function downloadText(filename, text, mime = 'application/octet-stream', withBom = false) {
  const parts = withBom ? ['\uFEFF', text] : [text];
  const blob = new Blob(parts, { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
