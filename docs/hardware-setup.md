# 実機接続とネットワーク構成

## 何が難しいか

カメラを Wi-Fi アクセスポイントにしてスマホを繋ぐと、スマホはインターネットに出られません。
つまり **Claude を呼べません**。この制約をどう回避するかで構成が決まります。

---

## 構成 A: カメラを既存の Wi-Fi に参加させる（推奨）

X100VI はアクセスポイントに接続する動作（ステーションモード）に対応しています。
カメラ・ブリッジサーバ・スマホの 3 者を同じネットワークに置く構成です。

```
        ┌──── 家/テザリングの Wi-Fi ────┐
        │                               │
    [X100VI]      [ブリッジサーバ]    [スマホ]
                    │
                    └──▶ インターネット ──▶ Claude API
```

- 最も素直で、全機能が使える
- ブリッジサーバは PC でも Raspberry Pi でも可
- スマホのテザリングを親にすれば屋外でも成立する

**手順**

1. カメラ側: `ネットワーク/USB設定` → `ネットワーク設定` で接続先アクセスポイントを登録
2. カメラの IP を確認（ルーターの DHCP 一覧、または `ネットワーク設定` の情報表示）
3. ブリッジサーバ側:
   ```bash
   export CAMERA_TRANSPORT=ptpip
   export CAMERA_HOST=<カメラのIP>
   export ANTHROPIC_API_KEY=sk-ant-...
   export ACCESS_TOKEN=$(openssl rand -hex 16)
   npm start
   ```
4. スマホから `http://<サーバのIP>:8080/?token=<ACCESS_TOKENの値>` を開く
   （トークンは端末に保存されるので次回以降は URL だけでよい）

---

## 構成 B: カメラをアクセスポイントにし、ブリッジは 2 系統持つ

カメラの AP に、スマホとブリッジサーバの両方が参加します。
ブリッジサーバは別系統（有線 LAN / LTE ドングル）でインターネットへ出ます。

```
   [X100VI (AP 192.168.0.1)]
        ├── [スマホ]
        └── [ブリッジサーバ] ──有線/LTE──▶ Claude API
```

- 既存の Wi-Fi が無い屋外で使える
- ブリッジサーバに 2 つのネットワークインタフェースが必要
- ルーティングの調整が要るので、構成 A より手間がかかる

---

## 構成 C: 完全オフライン

インターネットに出られない環境では、ルールベース提案器だけで運用します。

```bash
export AI_OFFLINE=true
```

提案の質は落ちますが、露出計算・機種制約の解決・カメラへの適用はすべて同じように動きます。
`fallbackReason` が UI に出るので、AI が使えていないことは撮影者に伝わります。

---

## 接続方式の選択

### `sdk-bridge`（本番推奨）

公式の **FUJIFILM Camera Remote SDK** をラップした小さな HTTP サーバを別プロセスで動かし、
そこへ委譲します。リバースエンジニアリングに依存しないので確実です。

ブリッジ側に実装すべき API:

```
GET  /status                 → { connected, model, batteryPercent, current, meteredEv100 }
POST /connect                → { connected, model, ... }
POST /disconnect             → 204
POST /settings  { ...差分 }  → { outcomes: [{ field, status, detail }] }
POST /capture                → 204
```

`outcomes[].status` は `applied` / `unsupported` / `failed` のいずれか。

```bash
export CAMERA_TRANSPORT=sdk-bridge
export SDK_BRIDGE_URL=http://127.0.0.1:8787
```

### `ptpip`（Wi-Fi 直結）

追加のプロセスが要らない反面、富士フイルム独自プロパティのコードが未検証です。
必ず先に調査してください。

```bash
# 1. 実機の対応プロパティを一覧化する
npm run discover -- --host 192.168.0.1

# 2. 結果をもとに上書き定義を書く
cp config/fuji-properties.example.json config/fuji-properties.json
$EDITOR config/fuji-properties.json

# 3. まず dry-run で、送るはずのフレームだけ確認する
CAMERA_TRANSPORT=ptpip CAMERA_DRY_RUN=true npm start

# 4. 問題なければ実際に送る
CAMERA_TRANSPORT=ptpip npm start
```

初回接続時、カメラの液晶に接続許可の確認が出ることがあります。
カメラの画面を見ながら実行してください。

---

## 実機で最初に確認すべきこと

X100VI は**物理ダイヤルが優先される**カメラです。リモートから値を書いても、
ダイヤルがその位置にあると拒否されます。

| 設定したいもの | カメラ側で必要な状態 |
|---|---|
| 絞りをリモート指定 | 絞りリングを **A** に |
| シャッター速度をリモート指定 | SS ダイヤルを **A** に |
| ISO をリモート指定 | ISO ダイヤル（またはコマンドダイヤル）を **A / C** に |
| 露出補正をリモート指定 | 露出補正ダイヤルを **C** に |

拒否された場合、適用結果にその項目が `failed` として理由付きで返ります
（`カメラ側で操作が拒否されました（ダイヤルが物理位置に固定されている可能性）`）。
提案自体は表示されているので、手で合わせることもできます。

---

## トラブルシューティング

| 症状 | 確認すること |
|---|---|
| 接続がタイムアウトする | カメラの Wi-Fi が有効か。`CAMERA_HOST` の IP が正しいか。同じサブネットにいるか |
| `カメラが接続を拒否しました（InitFail）` | カメラ画面の接続許可を承認したか。別の端末が既に接続していないか |
| 一部の項目だけ `failed` | 上の物理ダイヤル表を確認 |
| 全項目が `unsupported` でスキップされる | `ALLOW_UNVERIFIED_PROPS=false` のため。discover の結果を反映してから true にする |
| 提案は出るが `fallbackReason` が出る | `ANTHROPIC_API_KEY` の設定、またはインターネット接続を確認 |
| スマホから開けない | ブリッジサーバの `HOST=0.0.0.0`、PC のファイアウォール、同じネットワークにいるか |
