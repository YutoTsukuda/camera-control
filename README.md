# X100VI AI 撮影設定アシスタント

FUJIFILM X100VI の**静止画撮影設定を、スマートフォンから AI で自動決定・自動反映**するシステムです。

撮ろうとしているシーンにスマホを向けて 1 枚撮り、撮りたいものを数タップで伝えると、
Claude が光を読み取って絞り・シャッター速度・ISO・フィルムシミュレーション・AF・測光などを決め、
Wi-Fi 経由でカメラに書き込みます。

```
[スマホ PWA]  ──HTTP──▶  [ブリッジサーバ (Node)]  ──USB──▶  [X100VI]
  写真+意図                  ├─ Claude（シーン読解・絵作り）
  提案の確認                 ├─ 露出ソルバ（決定論的な計算）
  ワンタップ適用             └─ バリデータ（機種制約の解決）
```

カメラとの接続は **USB（gphoto2）を推奨**します。無線の切断がそもそも起きず、
プロパティ名も選択肢も実機が申告したものだけを使うため、推測が入りません。
スマホ ↔ ブリッジ間は無線のままなので操作感は変わりません。

---

## なぜこの構成か

**AI に露出の最終値を決めさせていません。** AI が担うのは、数値計算では決められないこと
——シーンの光をどう読むか、どの軸を優先するか、どのフィルムシミュレーションが合うか——だけです。
実際の F 値・シャッター速度・ISO は決定論的なソルバが確定させ、最後にバリデータが機種固有の制約を解きます。

この分担により、モデルの出力揺れが露出精度に直結しません。
「AI が 1/8000 秒と言ったが F2 のリーフシャッターでは切れない」といった破綻は、
AI の賢さではなく**型と計算で**防がれます。

X100VI 特有の制約は仕様テーブル（`src/domain/capabilities.ts`）に集約しています。とくに:

| 絞り | メカニカルシャッターの上限 |
|---|---|
| F2 〜 F2.5 | 1/1000 秒 |
| F2.8 〜 F3.6 | 1/2000 秒 |
| F4 以上 | 1/4000 秒 |

X100 シリーズのレンズシャッターは開放側ほど最高速が下がります。
日中に F2 でボケを出そうとすると必ずここに当たるため、システムは自動で
**内蔵 ND（4段）→ 電子シャッター併用 → 絞り込み** の順に逃がし、
何をなぜ変えたかを日本語で UI に表示します。

---

## 動かす

実機がなくても、モックカメラとルールベース提案で全機能を試せます。

```bash
npm install
npm test          # 112 テスト
npm run build
npm start         # http://localhost:8080
```

スマホから同じ Wi-Fi の PC の IP へアクセスすれば、そのまま PWA として使えます
（ホーム画面に追加可能）。

### Claude を有効にする

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

`ANTHROPIC_API_KEY` が未設定なら自動的にルールベース（オフライン）で動きます。
API が落ちていても、電波が届かなくても、提案は必ず返ります。

### 実機に接続する（USB）

```bash
sudo apt install gphoto2          # macOS は brew install gphoto2

# Linux デスクトップでは自動マウントを止める（最頻出のつまずき）
systemctl --user stop gvfs-gphoto2-volume-monitor

# カメラ側: 接続設定 → USB接続モード → USB テザー撮影
# USBで繋いだ状態で、まず実機を調べる
npm run probe

# 照合結果を確認したら起動
CAMERA_TRANSPORT=gphoto2 npm start
```

`npm run probe` はカメラが申告する設定ツリーを読み、
どのフィールドがどの設定に解決できたか、列挙値がどの選択肢に照合されたかを
1 件ずつ表示して `config/gphoto2-mapping.json` に保存します。
**実機運用は必ずここから始めてください。**

手順の詳細（権限、systemd での常駐、物理ダイヤルの制約、Windows での動かし方）は
**[docs/usb-setup.md](docs/usb-setup.md)** にまとめています。

> **X100VI が libgphoto2 の機種一覧に無くても動きます。**
> `USB PTP Class Camera` という汎用エントリがあり、PTP クラスを名乗るカメラは
> 機種登録なしで検出されます。実際に何が読めるかは `npm run probe` が教えてくれます。

---

## 使い方（スマホ）

1. **シーンを撮る** — これから撮る場所にスマホを向けて 1 枚。長辺 1280px に縮小して送るので通信は軽い。
2. **撮りたいものを伝える** — 被写体 / 優先軸 / 動き / 手持ちか三脚か、をタップ。ひとこと自由記述も可。
3. **提案を受け取る** — 露出 4 項目が大きく出て、シーンの読み取り・理由・注意点・システムが補正した内容が並ぶ。
4. **カメラに適用** — 1 タップ。項目ごとの成否が返る。

---

## 構成

```
src/
  domain/          機種仕様と計算（AI に依存しない中核）
    capabilities.ts  X100VI の設定可能値・リーフシャッター上限・IBIS 段数
    exposure.ts      露出ソルバ（EV 計算、手ブレ限界、ND/電子シャッターへの逃がし）
    validate.ts      機種制約の解決（DRとISO、モノクロと彩度、RAWとデジタルテレコン…）
    scenes.ts        シーン輝度の参照表
    labels.ts        日本語表示名
  ai/
    schema.ts        Claude の構造化出力スキーマ（zod）
    prompt.ts        システムプロンプト（仕様表から自動生成 → キャッシュが効く）
    advisor.ts       Claude 呼び出し
    rules.ts         ルールベース提案器（オフライン/フォールバック）
    compose.ts       Advice → 設定への合成（ソルバ＋バリデータ）
  camera/
    types.ts         アダプタ抽象
    mock.ts          モックカメラ（測光値・拒否・遅延を再現）
    gphoto2/         USB接続（推奨）。実機が申告した設定ツリーから解決する
    ptpip/           Wi-Fi (PTP/IP)。接続手順が未完成
    sdkBridge.ts     公式 SDK ブリッジへの委譲（Windows向け）
  server/app.ts      ブリッジサーバ（REST + SSE + 静的配信）
  web/               スマホ PWA（ビルド不要の素の ES モジュール）
  tools/probe.ts     実機調査 CLI（USB / gphoto2）※ 実機運用はここから
  tools/discover.ts  実機調査 CLI（Wi-Fi / PTP-IP）
```

- [docs/usb-setup.md](docs/usb-setup.md) — **USB接続での実機セットアップ（推奨経路）**
- [docs/architecture.md](docs/architecture.md) — 設計の意図と責務分担
- [docs/hardware-setup.md](docs/hardware-setup.md) — ネットワーク構成と Wi-Fi 経路
- [docs/protocol-notes.md](docs/protocol-notes.md) — PTP/IP と独自プロパティの確度
- [docs/x100vi-reference.md](docs/x100vi-reference.md) — 実装が依拠する機種仕様

---

## API

| メソッド | パス | 用途 |
|---|---|---|
| GET | `/api/health` | 稼働確認・現在の動作モード |
| GET | `/api/capabilities` | 機種の設定可能値と日本語ラベル |
| GET | `/api/camera/status` | 接続状態・測光値・現在設定 |
| POST | `/api/camera/connect` / `/disconnect` | 接続制御 |
| POST | `/api/advise` | 写真 + 意図 → 設定提案 |
| POST | `/api/apply` | 設定をカメラへ書き込み |
| POST | `/api/auto` | 提案から適用までを一度に |
| POST | `/api/capture` | シャッターを切る |
| GET | `/api/events` | ログのライブ配信（SSE） |

`ACCESS_TOKEN` を設定すると `X-Access-Token` ヘッダ（または `?token=`）が必須になります。

---

## セキュリティ

- **API キーは端末に置かない。** Claude の呼び出しはブリッジサーバ側だけで行います。
- **カメラの Wi-Fi は無防備なことがある。** 屋外運用では `ACCESS_TOKEN` を必ず設定してください。
- 静的配信はディレクトリトラバーサルを拒否します。

---

## 検証状況

| レイヤー | 状態 |
|---|---|
| 露出ソルバ・バリデータ | 単体テスト済み（境界条件・冪等性・全組み合わせ走査） |
| gphoto2 出力パーサ | 単体テスト済み。**出力書式は gphoto2 バイナリの書式文字列から確定**（版差による END 区切りの有無も両対応） |
| gphoto2 マッピング・値照合 | 単体テスト済み（フィルムシミュレーション20種、ACROS と ACROS+R の取り違え防止を含む） |
| gphoto2 アダプタ | 実行器を差し替えて検証済み（一括適用、失敗時の個別再試行、離脱検知） |
| gphoto2 CLI の呼び出し | **実バイナリで検証済み**（検出失敗時のエラー翻訳まで） |
| PTP/IP パケット層・オペレーション層 | 単体テスト済み（分割受信・往復変換・DeviceInfo 解析） |
| Claude リクエストの組み立て | SDK クライアントを差し替えて検証済み（実 API 呼び出しは未実施） |
| ブリッジサーバ | モックカメラでの結合テスト済み |
| **実機 X100VI との USB 通信** | **未検証。** `npm run probe` が最初の確認手段 |
| Wi-Fi (`ptpip`) 経路 | **未完成。** イベントチャンネルの確立を実装していないため接続できない |
