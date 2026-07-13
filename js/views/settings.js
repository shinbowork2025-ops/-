// 設定(プリセット・テンプレート・バックアップ・データ管理)

import * as db from '../db.js';
import * as store from '../store.js';
import { csvEscape, downloadText, esc, todayStr, uid } from '../util.js';
import { confirmDialog, openModal, toast } from '../ui.js';

function rerender() { window.dispatchEvent(new Event('app:rerender')); }

export async function render(el) {
  const presets = await db.getPresets();
  const templates = await db.getTemplates();
  const meta = await db.getMeta();

  let storageInfo = '';
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      storageInfo = `使用量 ${(est.usage / 1024).toFixed(0)}KB`;
    } catch { /* 非対応環境 */ }
  }
  const persisted = store.isPersisted();

  el.innerHTML = `
    <div class="card">
      <h3>スケジュールのプリセット</h3>
      <div class="muted">名前・色・並び順・表示/非表示を変更できます</div>
      <div data-sec="presets">
        ${presets.map((p, i) => `
          <div class="preset-row" data-id="${p.id}">
            <button class="btn mini" data-act="up" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="btn mini" data-act="down" ${i === presets.length - 1 ? 'disabled' : ''}>▼</button>
            <input type="color" value="${p.color}" data-f="color">
            <input type="text" value="${esc(p.name)}" data-f="name">
            <button class="btn mini" data-act="vis" title="表示/非表示">${p.visible ? '👁' : '🚫'}</button>
            <button class="btn mini ghost-danger" data-act="del">🗑</button>
          </div>`).join('')}
      </div>
      <button class="btn small block mt8" data-act="add-preset">＋ プリセットを追加</button>
    </div>

    <div class="card">
      <h3>スケジュールテンプレート</h3>
      <div class="muted">作成はスケジュール編集画面の「テンプレ保存」から</div>
      ${templates.length === 0 ? '<div class="muted mt8">テンプレートはありません</div>' : templates.map(t => `
        <div class="preset-row" data-tpl="${t.id}">
          <input type="text" value="${esc(t.name)}" data-f="tpl-name">
          <button class="btn mini ghost-danger" data-act="tpl-del">🗑</button>
        </div>`).join('')}
    </div>

    <div class="card">
      <h3>バックアップ</h3>
      <div class="muted">最終バックアップ: ${meta.lastBackupAt ? new Date(meta.lastBackupAt).toLocaleString('ja-JP') : 'なし'}</div>
      <div class="btn-row">
        <button class="btn primary" data-act="export">JSONバックアップ出力</button>
        <button class="btn" data-act="import">JSONから復元</button>
      </div>
      <input type="file" accept=".json,application/json" data-f="import-file" class="hidden">
      <button class="btn block mt8" data-act="csv">客注をCSV出力</button>
    </div>

    <div class="card">
      <h3>ストレージ</h3>
      <div>永続保存: ${persisted === true ? '✅ 許可済み' : persisted === false ? '⚠ 未許可(データが自動削除される可能性があります)' : '確認中'}</div>
      ${storageInfo ? `<div class="muted">${storageInfo}</div>` : ''}
      ${persisted === false ? '<button class="btn small mt8" data-act="persist">永続保存を再要求</button>' : ''}
    </div>

    <div class="card">
      <h3>データの初期化</h3>
      <button class="btn ghost-danger block" data-act="wipe">全データを削除</button>
    </div>

    <div class="muted center">店舗業務ノート v${db.SCHEMA_VERSION} / データはこの端末内にのみ保存されます</div>`;

  bindPresetHandlers(el, presets);
  bindTemplateHandlers(el, templates);
  bindBackupHandlers(el);
}

// ---- プリセット ----

function bindPresetHandlers(el, presets) {
  const save = async () => { await db.savePresets(presets); rerender(); };

  el.querySelectorAll('.preset-row[data-id]').forEach(row => {
    const p = presets.find(x => x.id === row.dataset.id);
    if (!p) return;
    row.querySelector('[data-f="name"]').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (v) { p.name = v; db.savePresets(presets); }
    });
    row.querySelector('[data-f="color"]').addEventListener('change', (e) => {
      p.color = e.target.value; db.savePresets(presets);
    });
    row.querySelector('[data-act="vis"]').addEventListener('click', () => { p.visible = !p.visible; save(); });
    row.querySelector('[data-act="up"]').addEventListener('click', () => {
      const i = presets.indexOf(p);
      if (i > 0) { presets.splice(i, 1); presets.splice(i - 1, 0, p); save(); }
    });
    row.querySelector('[data-act="down"]').addEventListener('click', () => {
      const i = presets.indexOf(p);
      if (i < presets.length - 1) { presets.splice(i, 1); presets.splice(i + 1, 0, p); save(); }
    });
    row.querySelector('[data-act="del"]').addEventListener('click', async () => {
      const ok = await confirmDialog(
        `プリセット「${p.name}」を削除しますか?\n(登録済みのスケジュールのマスは「削除済み項目」と表示されます)`,
        { okLabel: '削除する', danger: true });
      if (!ok) return;
      presets.splice(presets.indexOf(p), 1);
      save();
    });
  });

  el.querySelector('[data-act="add-preset"]').addEventListener('click', () => {
    const name = window.prompt('プリセット名');
    if (!name || !name.trim()) return;
    presets.push({ id: `p-${uid()}`, name: name.trim(), color: '#2563eb', visible: true });
    save();
  });
}

// ---- テンプレート ----

function bindTemplateHandlers(el, templates) {
  el.querySelectorAll('.preset-row[data-tpl]').forEach(row => {
    const t = templates.find(x => x.id === row.dataset.tpl);
    if (!t) return;
    row.querySelector('[data-f="tpl-name"]').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (v) { t.name = v; db.saveTemplates(templates); }
    });
    row.querySelector('[data-act="tpl-del"]').addEventListener('click', async () => {
      if (!await confirmDialog(`テンプレート「${t.name}」を削除しますか?`, { okLabel: '削除する', danger: true })) return;
      templates.splice(templates.indexOf(t), 1);
      await db.saveTemplates(templates);
      rerender();
    });
  });
}

// ---- バックアップ・CSV・初期化 ----

function bindBackupHandlers(el) {
  el.querySelector('[data-act="export"]').addEventListener('click', async () => {
    const ok = await confirmDialog(
      'このバックアップにはお客様の氏名と客注メモが含まれます。\n共有端末やクラウド上での取扱いに注意してください。',
      { okLabel: '出力する' });
    if (!ok) return;
    const backup = await db.exportBackup();
    downloadText(`store-note-backup-${todayStr()}.json`, JSON.stringify(backup, null, 2), 'application/json');
    const meta = await db.getMeta();
    meta.lastBackupAt = new Date().toISOString();
    await db.saveMeta(meta);
    toast('バックアップを出力しました');
    rerender();
  });

  const fileInput = el.querySelector('[data-f="import-file"]');
  el.querySelector('[data-act="import"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let obj = null;
    try {
      obj = JSON.parse(await file.text());
    } catch {
      toast('JSONとして読み込めませんでした');
      return;
    }
    const err = db.validateBackup(obj);
    if (err) { toast(`復元できません: ${err}`); return; }

    const counts = `客注 ${obj.data.orders.length}件 / 集計 ${obj.data.summaries.length}日分`;
    const ok = await confirmDialog(
      `バックアップを復元しますか?\n(${counts}、出力日時: ${new Date(obj.exportedAt).toLocaleString('ja-JP')})\n\n現在のデータはすべて置き換えられます。`,
      { okLabel: '復元する', danger: true });
    if (!ok) return;

    await db.importBackup(obj);
    // 復元した当日データが過去日なら、その日付として締め処理される
    const r = await store.reloadAll();
    if (r.closedDate) toast(`復元した ${r.closedDate} の当日データは集計へ変換しました`, 3500);
    else toast('復元しました');
    rerender();
  });

  el.querySelector('[data-act="csv"]').addEventListener('click', async () => {
    const orders = await db.getOrders();
    if (orders.length === 0) { toast('客注データがありません'); return; }
    const header = ['案件番号', '名前', 'ステータス', 'メモ', '登録日時', '最終更新日時'];
    const lines = [header.join(',')].concat(orders.map(o => [
      o.caseNumber,
      csvEscape(o.customerNameKana),
      db.statusLabel(o.status),
      csvEscape(o.memo || ''),
      o.createdAt,
      o.updatedAt,
    ].join(',')));
    downloadText(`orders-${todayStr()}.csv`, lines.join('\r\n'), 'text/csv', true);
    toast('CSVを出力しました');
  });

  const persistBtn = el.querySelector('[data-act="persist"]');
  if (persistBtn) persistBtn.addEventListener('click', async () => {
    const ok = await navigator.storage.persist();
    store.setPersisted(ok);
    toast(ok ? '永続保存が許可されました' : '許可されませんでした(ホーム画面へのインストールで許可されやすくなります)', 3500);
    rerender();
  });

  el.querySelector('[data-act="wipe"]').addEventListener('click', async () => {
    if (!await confirmDialog('客注・集計・設定を含む全データを削除しますか?', { okLabel: '削除する', danger: true })) return;
    if (!await confirmDialog('本当に削除しますか?\nこの操作は元に戻せません。バックアップを取っていない場合は先に出力してください。', { okLabel: '完全に削除する', danger: true })) return;
    await db.wipeAll();
    await store.reloadAll();
    toast('全データを削除しました');
    rerender();
  });
}
