// バックアップ出力→全削除→復元の一連の確認
const { chromium } = require('playwright-core');
const fs = require('fs');

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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(800);

  // 客注を1件登録
  await page.click('#bottomnav a[data-route="orders"]');
  await page.waitForTimeout(300);
  await page.click('[data-act="add"]');
  await page.fill('[data-f="name"]', 'スズキ　イチロウ');
  await page.fill('[data-f="caseDigits"]', '777');
  await page.click('[data-act="save"]');
  await page.waitForTimeout(400);

  // バックアップ出力(警告→出力→ダウンロード)
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  const dlPromise = page.waitForEvent('download');
  await page.click('[data-act="export"]');
  await page.waitForTimeout(200);
  await page.click('button:has-text("出力する")');
  const dl = await dlPromise;
  const path = '/tmp/backup.json';
  await dl.saveAs(path);
  const backup = JSON.parse(fs.readFileSync(path, 'utf-8'));
  check('バックアップにschemaVersionがある', Number.isInteger(backup.schemaVersion));
  check('バックアップに客注が含まれる', backup.data.orders.some(o => o.caseNumber === 100777));
  await page.waitForTimeout(400);
  check('最終バックアップ日時が更新される', !(await page.locator('#view').textContent()).includes('最終バックアップ: なし'));

  // 全削除
  await page.click('[data-act="wipe"]');
  await page.click('button:has-text("削除する")');
  await page.waitForTimeout(200);
  await page.click('button:has-text("完全に削除する")');
  await page.waitForTimeout(500);
  await page.click('#bottomnav a[data-route="orders"]');
  await page.waitForTimeout(300);
  check('全削除で客注が消える', !(await page.locator('#view').textContent()).includes('100777'));

  // 復元
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  await page.setInputFiles('[data-f="import-file"]', path);
  await page.waitForTimeout(300);
  await page.click('button:has-text("復元する")');
  await page.waitForTimeout(600);
  await page.click('#bottomnav a[data-route="orders"]');
  await page.waitForTimeout(300);
  check('復元で客注が戻る', (await page.locator('#view').textContent()).includes('100777'));

  // 不正ファイルの拒否
  const badPath = path.replace('backup.json', 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({ hello: 'world' }));
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  await page.setInputFiles('[data-f="import-file"]', badPath);
  await page.waitForTimeout(500);
  check('不正ファイルは復元されない', (await page.locator('#toast-root').textContent()).includes('復元できません'));

  console.log('\n--- console/page errors ---');
  if (errors.length) errors.forEach(e => console.log(e));
  else console.log('(none)');
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
