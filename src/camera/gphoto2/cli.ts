/**
 * gphoto2 CLI の実行ラッパ。
 *
 * 設計判断: 常駐シェル（`gphoto2 --shell`）ではなく、毎回プロセスを起動する。
 * 長時間セッションを保持するとカメラ側のスリープや USB の一時的な切断で
 * 状態が壊れ、復旧経路が複雑になる。1 操作 1 プロセスなら、
 * 失敗しても次の操作は必ずまっさらな状態から始まる。
 * 代わりに 1 回の起動で複数の設定をまとめて書き込み、往復回数を減らす。
 */
import { execFile } from 'node:child_process';

export interface Gphoto2Result {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Gphoto2RunnerOptions {
  /** 実行ファイル名。既定は 'gphoto2'。 */
  binary?: string;
  /** `--port usb:001,005` のようにポートを固定する。複数台繋ぐ場合に必要。 */
  port?: string;
  timeoutMs?: number;
  logger?: (message: string) => void;
}

/** テストや別実装のために差し替えられる実行インタフェース。 */
export interface Gphoto2Runner {
  run(args: string[]): Promise<Gphoto2Result>;
}

export class Gphoto2CliError extends Error {
  constructor(
    message: string,
    readonly result: Gphoto2Result,
  ) {
    super(message);
    this.name = 'Gphoto2CliError';
  }
}

export class Gphoto2Cli implements Gphoto2Runner {
  constructor(private readonly options: Gphoto2RunnerOptions = {}) {}

  run(args: string[]): Promise<Gphoto2Result> {
    const binary = this.options.binary ?? 'gphoto2';
    const full = this.options.port ? ['--port', this.options.port, ...args] : args;
    this.options.logger?.(`$ ${binary} ${full.join(' ')}`);

    return new Promise((resolve) => {
      execFile(
        binary,
        full,
        { timeout: this.options.timeoutMs ?? 20_000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === 'number'
              ? ((error as unknown as { code: number }).code)
              : error
                ? 1
                : 0;
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code });
        },
      );
    });
  }
}

/**
 * gphoto2 のエラー出力を、撮影者に意味の通る日本語へ翻訳する。
 *
 * ここに並ぶのは実運用で必ず一度は踏むものばかりなので、
 * 「何をすれば直るか」まで書く。
 */
export function explainGphoto2Error(result: Gphoto2Result): string {
  const text = `${result.stderr}\n${result.stdout}`;

  if (/could not (claim|lock) the usb device|Device or resource busy/i.test(text)) {
    return (
      'カメラを別のプロセスが掴んでいます。Linux デスクトップの自動マウント（gvfs）が原因のことが多いです。' +
      ' `systemctl --user stop gvfs-gphoto2-volume-monitor` または該当プロセスの終了を試してください。'
    );
  }
  if (/No camera found|Could not detect any camera/i.test(text)) {
    return (
      'カメラが見つかりません。USB ケーブルの接続、カメラの電源、' +
      'カメラ側の「接続設定 → USB接続モード」が USB テザー撮影になっているかを確認してください。'
    );
  }
  if (/PTP I\/O Error|Could not (open|initialize) the camera/i.test(text)) {
    return 'カメラとの USB 通信に失敗しました。ケーブルを挿し直すか、カメラの電源を入れ直してください。';
  }
  if (/read only|Property .* is read only/i.test(text)) {
    return 'カメラ側でその項目が変更できない状態です（物理ダイヤルが A 以外の位置にある可能性）。';
  }
  if (/not found within list of choices/i.test(text)) {
    return 'その値はカメラの選択肢に存在しません。';
  }
  if (/Bad parameters|Could not set configuration/i.test(text)) {
    return 'カメラが値を受け付けませんでした（他の設定との排他、またはダイヤル位置の制約）。';
  }
  if (/ENOENT|not found/i.test(text) && /gphoto2/i.test(text)) {
    return 'gphoto2 が見つかりません。Linux なら `sudo apt install gphoto2`、macOS なら `brew install gphoto2` で導入してください。';
  }

  const firstLine = result.stderr.split('\n').find((line) => line.trim().length > 0);
  return firstLine ? firstLine.trim() : `gphoto2 が終了コード ${result.code} で失敗しました。`;
}
