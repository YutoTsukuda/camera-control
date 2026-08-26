# USB接続（gphoto2）での実機セットアップ

**これが推奨経路です。** 無線の切断がそもそも起きず、プロパティ名も選択肢も
実機が申告したものだけを使うため、推測が一切入りません。

```
[X100VI] ──USBケーブル──▶ [ブリッジ機 (Linux)] ◀──Wi-Fi── [スマホ]
                                    └──▶ インターネット ──▶ Claude API
```

スマホとブリッジ機の間は今まで通り無線なので、操作感は変わりません。
有線になるのはカメラとブリッジ機の間だけです。

---

## 0. どのマシンで動かすか

| OS | 可否 | 備考 |
|---|---|---|
| **Linux** | **推奨** | `apt install gphoto2` で完結。常駐させるならこれが最も堅い |
| macOS | 可 | `brew install gphoto2`。Linux と手順は同じ |
| Windows | 直接は不可 | libgphoto2 がネイティブに動かない。WSL2 + usbipd-win を使うか、`sdk-bridge` 方式にする（下記） |

Raspberry Pi にカメラをUSBで繋いでカメラバッグに入れておく構成が、
持ち出しも含めていちばん安定します。

---

## 1. gphoto2 を入れる

```bash
# Debian / Ubuntu / Raspberry Pi OS
sudo apt install gphoto2

# Fedora
sudo dnf install gphoto2

# macOS
brew install gphoto2

# 確認（2.5.28 以降であればよい）
gphoto2 --version
```

> **X100VI が機種一覧に無くても問題ありません。**
> libgphoto2 には `USB PTP Class Camera` という汎用エントリがあり、
> PTP クラスを名乗るカメラは機種登録が無くても検出されます。
> X100VI が明示登録されるのは新しい libgphoto2 からですが、
> 汎用エントリ経由で動作します。実際に検出できるかは次の手順で確認します。

## 2. カメラ側を USB テザー撮影にする

カメラのメニューで:

```
接続設定 → USB接続モード → USB テザー撮影 自動（または USB テザー撮影 固定）
```

「USB カードリーダー」になっているとカメラとして認識されません。
そのうえで USB ケーブルで繋ぎ、カメラの電源を入れます。

## 3. Linux の自動マウントを止める（最重要）

デスクトップ環境の Linux では、カメラを挿すと **gvfs が先に掴んでしまい**、
gphoto2 が `Could not claim the USB device` で失敗します。
これが実運用でいちばん多いつまずきです。

```bash
# その場しのぎ（今のセッションだけ）
systemctl --user stop gvfs-gphoto2-volume-monitor
pkill -f gvfsd-gphoto2

# 恒久対応（ブリッジ専用機ならこちらを推奨）
systemctl --user mask gvfs-gphoto2-volume-monitor
```

サーバ用途の Linux（デスクトップ環境なし）では、そもそもこの問題は起きません。

### 一般ユーザーで動かすための権限

`sudo` なしで動かすには、ユーザーを適切なグループに入れます。
libgphoto2 が導入する udev ルールが通常これを面倒見ますが、
`Could not claim` が続く場合は次を確認してください。

```bash
# カメラの USB ID を確認
lsusb | grep -i fuji

# plugdev グループに入る（ディストリによっては不要）
sudo usermod -aG plugdev "$USER"   # 再ログインが必要
```

## 4. 実機を調べる（ここが本題）

```bash
npm install
npm run probe
```

`probe` は次を行います。

1. カメラを検出できるか確認する
2. カメラが申告する設定ツリーを丸ごと読む
3. 本システムのどのフィールドが解決できたか／できなかったかを表示する
4. 列挙値の照合結果を 1 件ずつ表示する（どのフィルムシミュレーションがどの選択肢に当たったか）
5. 結果を `config/gphoto2-mapping.json` と `config/gphoto2-mapping-raw.txt` に保存する

出力例:

```
検出: Fujifilm X100VI  (usb:001,009)

設定ツリーを読み込んでいます（数秒かかります）…
118 項目を取得しました。
────────────────────────────────────────────────────────────────
解決できたフィールド (9)
────────────────────────────────────────────────────────────────

■ 絞り  →  /main/capturesettings/f-number  [RADIO]
    選択肢 19 件: f/2, f/2.2, f/2.5, f/2.8, f/3.2, f/3.6, f/4, f/4.5 …

■ フィルムシミュレーション  →  /main/capturesettings/filmsimulation  [RADIO]
    PROVIA_STD               → 「Provia/Standard」
    CLASSIC_CHROME           → 「Classic Chrome」
    ACROS                    → 「Acros」
    ACROS_R                  → 「Acros+R」
    ...
```

**必ず照合結果に目を通してください。** 特にフィルムシミュレーションと
ホワイトバランスは、機種によって表記が違うため取り違えが起こり得ます。
誤りがあれば `config/gphoto2-mapping.json` の `valueMap` を直すだけで矯正できます
（コードを変える必要はありません）。

解決できなかったフィールドは、適用時に「非対応」として報告され、送信されません。
カメラ側に別名で存在する場合は、`config/gphoto2-mapping-raw.txt` から名前を探し、
`src/camera/gphoto2/mapping.ts` の `candidates` に追加してください。

## 5. 起動する

```bash
export CAMERA_TRANSPORT=gphoto2
export ANTHROPIC_API_KEY=sk-ant-...
export ACCESS_TOKEN=$(openssl rand -hex 16)
export HOST=0.0.0.0
npm start
```

スマホから `http://<ブリッジ機のIP>:8080/?token=<ACCESS_TOKENの値>` を開きます。
トークンは端末に保存されるので、次回以降は URL だけで構いません。

## 6. 常駐させる（systemd）

`/etc/systemd/system/x100vi-assistant.service`:

```ini
[Unit]
Description=X100VI AI Shooting Assistant
After=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/camera-control
EnvironmentFile=/home/pi/camera-control/.env
ExecStart=/usr/bin/node dist/src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now x100vi-assistant
journalctl -u x100vi-assistant -f
```

---

## 動作の設計（なぜ安定か）

**1 操作 = 1 プロセス。** 常駐シェル（`gphoto2 --shell`）でカメラを開きっぱなしにすると、
カメラのスリープや USB の一時的な切断でセッション状態が壊れ、復旧経路が複雑になります。
毎回プロセスを起動する方式なら、失敗しても次の操作は必ずまっさらな状態から始まります。

**書き込みは 1 回にまとめる。** それでも往復が増えると遅いので、
1 回の適用でカメラへ送る全項目を 1 プロセスにまとめます。
**失敗したときだけ**項目ごとに再実行し、どれが原因かを特定します。

**値はインデックスで指定する。** 列挙値は文字列ではなく選択肢インデックスで送るため、
表記ゆれやエスケープの問題が起きません。

**離脱を検知する。** ケーブルが抜けた・カメラがスリープした場合、
状態取得が通信レベルで失敗した時点で接続状態を落とし、スマホ側に理由を通知します。
「繋がっているつもりで実は落ちている」状態を残しません。

---

## 物理ダイヤルの制約

X100VI は物理ダイヤルが優先されます。リモートから値を書いても、
ダイヤルがその位置にあると拒否されます。

| 設定したいもの | カメラ側で必要な状態 |
|---|---|
| 絞りをリモート指定 | 絞りリングを **A** に |
| シャッター速度をリモート指定 | SS ダイヤルを **A** に |
| ISO をリモート指定 | ISO を **A**（オート）または **C** に |
| 露出補正をリモート指定 | 露出補正ダイヤルを **C** に |

拒否された項目は「カメラ側でその項目が変更できない状態です（物理ダイヤルが A 以外の
位置にある可能性）」として個別に報告されます。提案自体は画面に残るので、手で合わせることもできます。

**運用の推奨**: 絞りリングとSSダイヤルを A、露出補正ダイヤルを C にしておけば、
提案がそのまま全部入ります。

---

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `Could not claim the USB device` | gvfs が掴んでいます。手順 3 を実行 |
| `No camera found` | USB接続モードが「USBテザー撮影」か確認。ケーブルが充電専用でないか確認 |
| 検出はできるが `--list-all-config` が空に近い | カメラがテザー撮影モードに入りきっていない。電源を入れ直す |
| フィルムシミュレーションが「非対応」になる | libgphoto2 が X100VI の該当プロパティを公開していない可能性。`config/gphoto2-mapping-raw.txt` を検索し、`/main/other/dXXXX` のような生プロパティが該当しないか確認 |
| 一部の項目だけ `failed` | 物理ダイヤルの表を確認 |
| 適用が遅い | 1 回の適用は 1〜3 秒程度が目安。それ以上かかる場合は一括適用が失敗して個別再試行に落ちている（ログに出ます） |
| 撮影中に接続が切れる | カメラのオートパワーオフを長め（またはOFF）にする |

---

## Windows で動かす場合

libgphoto2 は Windows でネイティブに動きません。選択肢は 2 つです。

### WSL2 + usbipd-win

Windows のUSBデバイスを WSL2 へ転送します。

```powershell
winget install usbipd
usbipd list                      # X100VI の BUSID を確認
usbipd bind   --busid <BUSID>
usbipd attach --wsl --busid <BUSID>
```

以降は WSL2 内で Linux と同じ手順です。ただし USB の転送層が 1 段増えるぶん、
スリープ復帰時などに再アタッチが必要になることがあります。
**安定稼働を優先するなら Linux 機で動かすことを勧めます。**

### 公式 SDK ブリッジ（`sdk-bridge`）

FUJIFILM Camera Remote SDK（C++）をラップした HTTP サーバを別途用意し、
本システムから委譲する方式です。Windows でネイティブに動きますが、
ブリッジ側の実装とビルドが別途必要です。
インタフェース仕様は [hardware-setup.md](hardware-setup.md) を参照してください。
