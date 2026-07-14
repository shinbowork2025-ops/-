// 店舗業務ノートのスモークテスト(Playwright + preinstalled Chromium)
const { chromium } = require('playwright-core');

const BASE = 'http://127.0.0.1:8123';
const results = [];
function check(name, cond) {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // --- 起動 ---
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(800);
  check('ホームが表示される', await page.locator('#view .now-block').count() === 1);
  check('下部ナビが5項目', await page.locator('#bottomnav a').count() === 5);
  check('中央に対応ボタンがある', await page.locator('#nav-cs').count() === 1);

  // --- TODO追加(FAB経由) ---
  await page.click('#fab-main');
  await page.click('[data-fab="todo"]');
  await page.fill('[data-f="text"]', 'テスト補充作業');
  await page.click('.chips button:has-text("急ぎ")');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  await page.click('#bottomnav a[data-route="todo"]');
  await page.waitForTimeout(300);
  check('TODOが一覧に出る', await page.locator('.todo-text:has-text("テスト補充作業")').count() === 1);

  // --- スケジュール編集(プリセットペイント) ---
  await page.click('#bottomnav a[data-route="schedule"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="edit"]');
  await page.waitForTimeout(200);
  await page.click('.chip.tool[data-id="p-reji"]');
  // 9:00のマス(slot 9)をタップ
  const cell = page.locator('.pg-cell[data-slot="9"]');
  await cell.dispatchEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 });
  await cell.dispatchEvent('pointerup', { bubbles: true, pointerId: 1 });
  await page.waitForTimeout(400);
  check('マスにレジが入る', (await page.locator('.pg-cell[data-slot="9"]').textContent()).includes('レジ'));

  // 自由記入をドラッグで塗り広げる(チップ選択時にテキスト入力)
  page.once('dialog', d => d.accept('自由テスト'));
  await page.click('.chip.tool[data-tool="free"]');
  await page.waitForTimeout(200);
  await page.locator('.pg-cell[data-slot="22"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const c20 = await page.locator('.pg-cell[data-slot="20"]').boundingBox();
  const c22 = await page.locator('.pg-cell[data-slot="22"]').boundingBox();
  await page.mouse.move(c20.x + c20.width / 2, c20.y + c20.height / 2);
  await page.mouse.down();
  await page.mouse.move(c22.x + c22.width / 2, c22.y + c22.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('自由記入がドラッグで3マス塗れる',
    (await page.locator('.pg-cell[data-slot="20"]').textContent()).includes('自由テスト') &&
    (await page.locator('.pg-cell[data-slot="22"]').textContent()).includes('自由テスト'));

  // スクロールレーンがある
  check('スクロールレーンがある', await page.locator('.scroll-rail').count() === 1);
  await page.click('[data-act="done"]');
  await page.waitForTimeout(300);
  check('タイムラインにレジのブロック', (await page.locator('.timeline').textContent()).includes('レジ'));

  // --- 客注登録 ---
  await page.click('#bottomnav a[data-route="orders"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="add"]');
  await page.fill('[data-f="name"]', 'ﾔﾏﾀﾞ ﾀﾛｳ'); // 半角カナ→全角変換の確認
  await page.fill('[data-f="caseDigits"]', '234');
  await page.fill('[data-f="memo"]', '網戸 90cm');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(400);
  check('客注が一覧に出る(No.100234)', (await page.locator('#view').textContent()).includes('100234'));
  check('半角カナが全角に変換される', (await page.locator('#view').textContent()).includes('ヤマダ　タロウ'));

  // 重複警告の確認
  await page.click('[data-act="add"]');
  await page.fill('[data-f="name"]', 'サトウ　ハナコ');
  await page.fill('[data-f="caseDigits"]', '234');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  const dupSheet = await page.locator('.modal-sheet h2').last().textContent();
  check('案件番号重複の警告が出る', dupSheet.includes('登録済み'));
  await page.click('button:has-text("このまま保存する")');
  await page.waitForTimeout(300);

  // 検索(数字→案件番号優先)
  await page.fill('[data-f="query"]', '100234');
  await page.waitForTimeout(600);
  check('案件番号で検索できる', await page.locator('.order-item').count() === 2);
  await page.fill('[data-f="query"]', '');
  await page.waitForTimeout(600);

  // ステータス変更(一覧から)
  await page.locator('.order-item .status-badge').first().click();
  await page.click('.sheet-items button:has-text("入荷未連絡")');
  await page.waitForTimeout(300);
  check('ステータスが変わる', (await page.locator('.order-item').first().textContent()).includes('入荷未連絡'));

  // --- 質問記録(タイマーなし手動) ---
  await page.click('#bottomnav a[data-route="questions"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="add"]');
  await page.fill('[data-f="placeAisle"]', '12');
  await page.fill('[data-f="content"]', '除草剤はどこにあるか');
  await page.fill('[data-f="destAisle"]', '18');
  await page.click('[data-f="tools"] button:has-text("DWH")');
  await page.fill('[data-f="outcome"]', '18番通路へ案内して解決');
  await page.fill('[data-f="minutes"]', '7');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  check('質問記録が一覧に出る', (await page.locator('#view').textContent()).includes('除草剤はどこにあるか'));
  check('結末が一覧に出る', (await page.locator('#view').textContent()).includes('18番通路へ案内して解決'));

  // --- お客様対応タイマー(下部中央ボタン) ---
  await page.click('#nav-cs');
  await page.waitForTimeout(400);
  check('ホームに対応中カード', await page.locator('.timer-card').count() === 1);
  check('中央ボタンが対応中表示になる', await page.locator('#nav-cs.running').count() === 1);
  await page.click('#nav-cs');
  await page.waitForTimeout(300);
  await page.fill('[data-f="content"]', 'タイマーテスト質問');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(300);
  check('タイマー終了後に記録が保存される', await page.locator('.timer-card').count() === 0);
  check('中央ボタンが通常表示に戻る', await page.locator('#nav-cs.running').count() === 0);

  // --- リロード後の永続化 ---
  await page.reload();
  await page.waitForTimeout(800);
  await page.click('#bottomnav a[data-route="todo"]');
  await page.waitForTimeout(300);
  check('リロード後もTODOが残る', (await page.locator('#view').textContent()).includes('テスト補充作業'));
  await page.click('#bottomnav a[data-route="orders"]');
  await page.waitForTimeout(300);
  check('リロード後も客注が残る', (await page.locator('#view').textContent()).includes('100234'));

  // --- 日付変更の締め処理(IndexedDBのmetaを昨日に書き換えて再現) ---
  await page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('store-work-note', 1);
    req.onsuccess = () => {
      const d = req.result;
      const y = new Date(Date.now() - 86400000);
      const pad = n => String(n).padStart(2, '0');
      const yStr = `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`;
      const tx = d.transaction(['daily', 'kv'], 'readwrite');
      const dailyStore = tx.objectStore('daily');
      const kvStore = tx.objectStore('kv');
      const getAll = dailyStore.getAll();
      getAll.onsuccess = () => {
        const today = getAll.result[0];
        dailyStore.delete(today.date);
        today.date = yStr;
        dailyStore.put(today);
        kvStore.get('meta').onsuccess = function () {
          const m = this.result;
          m.value.lastUsedDate = yStr;
          kvStore.put(m);
        };
      };
      tx.oncomplete = () => { d.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await page.waitForTimeout(1000);
  await page.click('#bottomnav a[data-route="todo"]');
  await page.waitForTimeout(300);
  check('日付変更でTODOが消える', !(await page.locator('#view').textContent()).includes('テスト補充作業'));
  await page.click('#bottomnav a[data-route="orders"]');
  await page.waitForTimeout(300);
  check('日付変更でも客注は残る', (await page.locator('#view').textContent()).includes('100234'));
  await page.click('#btn-summary');
  await page.waitForTimeout(400);
  const sumText = await page.locator('#view').textContent();
  check('日次集計が作られる', sumText.includes('質問2件'));
  // 集計詳細(時間帯別を含む)
  await page.click('.sum-date-item');
  await page.waitForTimeout(300);
  const detail = await page.locator('.modal-sheet').textContent();
  check('集計詳細に時間帯別がある', detail.includes('時間帯別') && detail.includes('時台'));
  check('集計詳細に通路別がある', detail.includes('12番通路'));

  console.log('\n--- console/page errors ---');
  if (errors.length) errors.forEach(e => console.log(e));
  else console.log('(none)');

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
