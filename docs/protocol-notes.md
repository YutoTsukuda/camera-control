# PTP/IP と独自プロパティの確度

このドキュメントは、実装のどこが**公開仕様に基づく確実な部分**で、
どこが**推定に基づく要検証の部分**かを明示するためのものです。

## 確度の 3 段階

コード上、各プロパティは `confidence` を持ちます。

| 値 | 意味 | 既定で送信するか |
|---|---|---|
| `standard` | PTP 標準仕様で定義済み。コードとデータ型が確定している | する |
| `community` | 実機または信頼できる情報で確認済み（`config/fuji-properties.json` で指定） | する |
| `unverified` | 推定値。実機で未確認 | **しない**（`ALLOW_UNVERIFIED_PROPS=true` で送信） |

未検証のプロパティを既定で送らないのは、予期しないコードへ書き込むと
カメラの別の設定を壊す可能性があるためです。

---

## 確実な部分

### パケット層（`src/camera/ptpip/packet.ts`）

PTP/IP のフレーム形式は仕様が公開されています。

```
+--------------------+--------------------+------------------+
| 全長 (uint32 LE)   | 種別 (uint32 LE)   | ペイロード        |
| ※この4バイトを含む  |                    |                  |
+--------------------+--------------------+------------------+
```

パケット種別:

| 値 | 種別 |
|---|---|
| 1 / 2 | InitCommandRequest / InitCommandAck |
| 3 / 4 | InitEventRequest / InitEventAck |
| 5 | InitFail |
| 6 / 7 | OperationRequest / OperationResponse |
| 8 | Event |
| 9 / 10 / 12 | StartData / Data / EndData |
| 13 / 14 | Ping / Pong |

TCP はメッセージ境界を保証しないため、`PacketReader` が受信バイトを貯めながら
完全なパケットだけを切り出します。分割受信・複数同時受信の両方をテストで固定しています。

### オペレーション層（`src/camera/ptpip/ptp.ts`）

| コード | 操作 |
|---|---|
| 0x1001 | GetDeviceInfo |
| 0x1002 / 0x1003 | OpenSession / CloseSession |
| 0x100E | InitiateCapture |
| 0x1014 | GetDevicePropDesc |
| 0x1015 / 0x1016 | GetDevicePropValue / SetDevicePropValue |

### PTP 標準デバイスプロパティ

| コード | プロパティ | 本システムでの対応 | 表現 |
|---|---|---|---|
| 0x5005 | WhiteBalance | `whiteBalance` | 列挙（日陰等はベンダ値が必要） |
| 0x5007 | FNumber | `aperture` | F値の 100 倍（F2.8 → 280） |
| 0x500A | FocusMode | `focusMode` | 列挙 |
| 0x500B | ExposureMeteringMode | `meteringMode` | 列挙 |
| 0x500D | ExposureTime | `shutterSpeedSec` | 0.1ms 単位（1/250秒 → 40） |
| 0x500E | ExposureProgramMode | `exposureMode` | 1=M, 2=P, 3=A, 4=S |
| 0x500F | ExposureIndex | `iso` | 数値、0xFFFF が AUTO |
| 0x5010 | ExposureBiasCompensation | `exposureCompensation` | 1/1000 EV 単位（+1EV → 1000） |
| 0x5013 | StillCaptureMode | `driveMode` | 1=1コマ, 2=連写 |

これらの符号化・復号は単体テストで往復検証しています。

---

## 要検証の部分

### 富士フイルム独自プロパティ（0xD000 以降）

フィルムシミュレーション、ダイナミックレンジ、グレイン、クラリティ、
Dレンジ優先などは PTP 標準に存在せず、ベンダ独自の領域に置かれています。
このコード体系は公開されておらず、**本リポジトリの既定値は推定です**。

そのため:

1. 既定表（`src/camera/ptpip/fujiProps.ts`）では `confidence: 'unverified'` としている
2. 未検証のものは既定で送信しない
3. `config/fuji-properties.json` でコード・データ型・値表を丸ごと差し替えられる
   （コードを触らずに直せる）

### 独自プロパティの調べ方

```bash
npm run discover -- --host 192.168.0.1
```

`GetDeviceInfo` を読み、カメラが対応しているデバイスプロパティを一覧表示します。

```
=== ベンダ独自プロパティ (37) ===
  0xd001  → filmSimulation (unverified)
  0xd007  → dynamicRange (unverified)
  0xd00a  → 未マッピング
  ...

=== 警告: 既定表にあるがカメラが対応していないコード ===
  dynamicRange: 0xd007 (unverified)
  config/fuji-properties.json で正しいコードに差し替えてください。
```

「未マッピング」のコードが目的のプロパティかどうかは、
`GetDevicePropValue` で読んだ値と、カメラ本体で設定を変えたときの変化を突き合わせて特定します。
`CAMERA_DRY_RUN=true` にすると、送るはずのフレームだけをログに出せます。

### 標準プロパティでも注意が必要な点

- **列挙値の網羅性**: PTP 標準の WhiteBalance には「日陰」「水中」「色温度指定」に対応する値がなく、
  ベンダ定義値（0x8000 以降）が必要です。既定表では該当値を持たないため送信をスキップします。
- **ドライブモード**: `StillCaptureMode` は「1コマ / 連写」程度しか区別できません。
  高速連写と低速連写の区別にはベンダ値が必要です。
- **物理ダイヤルの優先**: X100VI は絞りリング・SS ダイヤル等が物理優先です。
  ダイヤルが A 以外の位置にあると、標準プロパティでも書き込みが拒否されます
  （PTP の応答コード `AccessDenied` / `InvalidDevicePropValue` として返ります）。

---

## 公式 SDK を使う選択肢

以上の不確実性を避けたい場合は `sdk-bridge` 方式を使ってください。
公式の FUJIFILM Camera Remote SDK が対応プロパティを正式に定義しているため、
推定に依存しません。SDK は C++ のネイティブライブラリなので、
それをラップした小さな HTTP サーバを別プロセスで動かし、本システムから委譲します。

インタフェース仕様は [hardware-setup.md](hardware-setup.md#sdk-bridge本番推奨) を参照してください。
