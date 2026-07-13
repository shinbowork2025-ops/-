# 店舗業務ノート

ホムセン店舗で使うために作成したツールです。要件定義以外AI製。

店舗勤務中にスマートフォンで使う個人用の業務補助PWA。
スケジュール(15分単位)・当日TODO・お客様質問記録・客注管理を1つのアプリで扱う。

- データはすべて端末内(IndexedDB)に保存。サーバー送信・ログイン・共有機能なし
- オフライン動作(Service Workerによる事前キャッシュ)
- ビルド不要の静的なHTML/CSS/JS(ESモジュール)

## 起動方法(ローカル)

ビルドは不要。静的サーバーで配信するだけで動く。

```sh
python3 -m http.server 8123
# → http://localhost:8123 を開く
```

※ `file://` で直接開くとService Worker(オフライン対応)が動かないため、必ずHTTPで配信する。

## デプロイ(GitHub Pages)

`main` へのpushで `.github/workflows/pages.yml` が自動デプロイする。
初回のみリポジトリの Settings → Pages → Source を「GitHub Actions」に設定すること。
全パスは相対参照なのでサブパス配信(`https://<user>.github.io/<repo>/`)でもそのまま動く。

## テスト方法

Playwright(Chromium)によるスモークテスト。

```sh
npm install playwright-core
npx playwright install chromium   # Chromium未導入の場合のみ
python3 -m http.server 8123 &     # アプリを配信しておく
CHROME_PATH=/path/to/chrome node tests/smoke.js         # 主要機能・日付変更処理
CHROME_PATH=/path/to/chrome node tests/smoke-backup.js  # バックアップ→全削除→復元
```

## PWAインストール方法

- **iPhone (Safari)**: 配信URLを開く → 共有ボタン → 「ホーム画面に追加」
- **Android (Chrome)**: 配信URLを開く → メニュー → 「アプリをインストール」(または表示されるバナー)

ホーム画面から起動するとスタンドアロン表示になり、ストレージの永続化も許可されやすくなる。

## IndexedDBを初期化する方法

- アプリ内: 設定 → 「全データを削除」(確認2回)
- ブラウザから: DevTools → Application → IndexedDB → `store-work-note` を削除
  (Safariの場合: 設定 → Safari → 詳細 → Webサイトデータ から削除)

## バックアップと復元の確認手順

1. 客注などのデータをいくつか登録する
2. 設定 → 「JSONバックアップ出力」→ 警告を確認して出力(ファイルが保存される)
3. 設定 → 「全データを削除」
4. 設定 → 「JSONから復元」→ 保存したファイルを選択 → 確認して復元
5. 客注・集計・プリセット・テンプレートが戻っていることを確認

復元は**全上書きのみ**(結合はしない)。復元した当日データの日付が過去の場合は、
その日付として自動的に締め処理され日次集計へ変換される。

## データの扱い(設計上の境界)

| 日付が変わると消去(集計へ変換) | 日をまたいで保持 |
|---|---|
| スケジュール本体 | 客注 |
| 当日TODO | 日次集計結果 |
| お客様質問の個別記録 | スケジュールプリセット/テンプレート |
| 対応中タイマー(破棄) | アプリ設定 |

日付変更は「起動時・画面再表示時・すべての書き込み直前」に検出する。
端末の日付が過去に巻き戻っている場合はデータを消さず警告のみ表示する。

## 既知の制限

- ブラウザのサイトデータ削除(iOS Safariの7日間未使用削除など)には勝てない。
  起動時に永続ストレージを要求し、バックアップが7日以上古いとホームに通知を出すことで緩和している。
  **こまめなJSONバックアップを推奨**
- スケジュールの対象時間は 6:45〜20:15(15分×54区間)固定。時間外は「時間外です」と表示
- お客様対応タイマーは同時に1件のみ。日付をまたいだタイマーは記録されず破棄される
- 復元のマージ(結合)は非対応。全上書きのみ
- 日次集計後は質問・TODOの個別内容を復元できない(集計値のみ残る)
- アプリの更新にはネット接続が必要(データ操作はオフラインで完結)

## 今後追加しやすい拡張点

- 日次集計のCSV出力(集計データは構造化済み)
- スケジュール対象時間の設定化(`js/util.js` の `DAY_START`/`DAY_END` を設定値に置き換え)
- 退勤時刻の設定とTODO「退勤まで」の並び順への反映
- 集計の週次・月次ロールアップ画面
- Web Share APIによるバックアップファイルの共有シート連携

## ディレクトリ構成

```
index.html            アプリシェル
manifest.webmanifest  PWAマニフェスト
sw.js                 Service Worker(事前キャッシュ)
css/app.css           全スタイル
js/util.js            時刻・カナ変換・CSVなどの共通処理
js/db.js              IndexedDB・締め処理・集計・バックアップ
js/store.js           当日データの共有状態(書き込み前の日付チェック)
js/ui.js              モーダル・トースト・チップUI
js/app.js             ルーティング・FAB・PWA登録
js/views/*.js         各画面(home/schedule/todo/questions/orders/summary/settings)
tests/*.js            Playwrightスモークテスト
icons/                PWAアイコン
```
