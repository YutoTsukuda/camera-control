/**
 * USB（gphoto2）経由のカメラアダプタ。
 *
 * 本システムで最も安定して動く経路。理由:
 *   - USB なので無線の切断・再接続がそもそも起きない
 *   - プロパティ名も選択肢も実機が申告したものだけを使う（推測ゼロ）
 *   - libgphoto2 はオープンソースで、挙動を追跡・検証できる
 *
 * 1 回の適用は 1 プロセスにまとめて往復を減らし、失敗したときだけ
 * 項目ごとに再実行して原因を特定する。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Gphoto2Cli, explainGphoto2Error, type Gphoto2Runner } from './cli.js';
import { parseAutoDetect, parseConfigList } from './parse.js';
import { encodeSet, resolveMapping, type MappingReport, type ResolvedField } from './mapping.js';
import { settingsEv } from '../../domain/exposure.js';
import { FIELD_LABELS } from '../../domain/labels.js';
import type { ShootingSettings } from '../../domain/types.js';
import type { ApplyOutcome, ApplyResult, CameraAdapter, CameraStatus } from '../types.js';
import { CameraNotConnectedError } from '../types.js';

export interface Gphoto2AdapterOptions {
  binary?: string;
  /** `usb:001,005` のようにポートを固定する。カメラを複数繋ぐ場合のみ必要。 */
  port?: string;
  timeoutMs?: number;
  /**
   * 解決済みマッピングの保存先。
   * 接続のたびに `--list-all-config` を読むのは数秒かかるので、
   * 一度解決したらここへ保存し、次回からはこれを読む。
   */
  mappingPath?: string;
  /** 保存済みマッピングを無視して毎回実機から解決し直す。 */
  alwaysRescan?: boolean;
  runner?: Gphoto2Runner;
  logger?: (message: string) => void;
}

interface StoredMapping {
  savedAt: string;
  model: string;
  resolved: ResolvedField[];
}

export class Gphoto2Camera implements CameraAdapter {
  readonly transport = 'gphoto2';
  private readonly runner: Gphoto2Runner;
  private connected = false;
  private model?: string;
  private mapping = new Map<keyof ShootingSettings, ResolvedField>();
  private lastReport?: MappingReport;

  constructor(private readonly options: Gphoto2AdapterOptions = {}) {
    this.runner =
      options.runner ??
      new Gphoto2Cli({
        ...(options.binary ? { binary: options.binary } : {}),
        ...(options.port ? { port: options.port } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.logger ? { logger: options.logger } : {}),
      });
  }

  async connect(): Promise<CameraStatus> {
    const detect = await this.runner.run(['--auto-detect']);
    if (detect.code !== 0) throw new Error(explainGphoto2Error(detect));

    const cameras = parseAutoDetect(detect.stdout);
    if (cameras.length === 0) {
      throw new Error(
        'カメラが検出できませんでした。USBケーブルの接続と、カメラ側の「接続設定 → USB接続モード」が' +
          ' USB テザー撮影（またはUSB自動）になっているかを確認してください。',
      );
    }
    this.model = cameras[0]?.model ?? 'unknown';
    this.log(`検出: ${this.model} (${cameras[0]?.port})`);

    await this.loadMapping();
    this.connected = true;
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    // gphoto2 はプロセス単位で開閉するため、保持している接続は無い。
    this.connected = false;
  }

  async getStatus(): Promise<CameraStatus> {
    if (!this.connected) {
      return { connected: false, transport: this.transport };
    }

    const read = await this.readCurrentSettings();

    // カメラが抜かれた・スリープした場合、ここで初めて気づく。
    // 「繋がっているつもりで実は落ちている」状態を UI に残さないよう、
    // 読み出しが通信レベルで失敗したら接続状態を落とす。
    if (read.disconnected) {
      this.connected = false;
      return {
        connected: false,
        transport: this.transport,
        ...(read.error ? { lastError: read.error } : {}),
      };
    }

    const status: CameraStatus = {
      connected: true,
      transport: this.transport,
      ...(read.settings ? { current: read.settings } : {}),
      ...(read.error ? { lastError: read.error } : {}),
    };
    if (this.model) status.model = this.model;

    const battery = await this.readBatteryPercent();
    if (battery !== undefined) status.batteryPercent = battery;

    // カメラ自身が今選んでいる露出から、被写体輝度を逆算する。
    // 専用の測光値を読む手段が無いので、これが実用上いちばん確実な近似。
    const meter = this.deriveMeteredEv(read.settings);
    if (meter !== undefined) status.meteredEv100 = meter;

    return status;
  }

  async applySettings(settings: ShootingSettings): Promise<ApplyResult> {
    if (!this.connected) throw new CameraNotConnectedError();
    const started = Date.now();
    const outcomes: ApplyOutcome[] = [];
    const planned: { field: keyof ShootingSettings; requested: unknown; args: string[] }[] = [];

    for (const [field, value] of Object.entries(settings) as [keyof ShootingSettings, unknown][]) {
      if (value === undefined) continue;
      const resolved = this.mapping.get(field);

      if (!resolved) {
        outcomes.push({
          field,
          requested: value,
          status: 'unsupported',
          detail: `${FIELD_LABELS[field] ?? field} はこのカメラの設定ツリーに見つかりませんでした。`,
        });
        continue;
      }

      const encoded = encodeSet(resolved, value);
      if ('reason' in encoded) {
        outcomes.push({
          field,
          requested: value,
          status: 'unsupported',
          detail: `${FIELD_LABELS[field] ?? field}: ${encoded.reason}`,
        });
        continue;
      }

      const { set } = encoded;
      planned.push({
        field,
        requested: value,
        args:
          set.index !== undefined
            ? ['--set-config-index', `${set.path}=${set.index}`]
            : ['--set-config-value', `${set.path}=${set.value ?? ''}`],
      });
    }

    if (planned.length > 0) {
      // まず一括で試す（USB の往復が 1 回で済む）。
      const batch = await this.runner.run(planned.flatMap((item) => item.args));

      if (batch.code === 0) {
        for (const item of planned) {
          outcomes.push({ field: item.field, requested: item.requested, status: 'applied' });
        }
      } else {
        // 一括が失敗したときだけ、どの項目が原因かを個別実行で特定する。
        this.log(`一括適用に失敗したため個別に再試行します: ${explainGphoto2Error(batch)}`);
        for (const item of planned) {
          const single = await this.runner.run(item.args);
          outcomes.push(
            single.code === 0
              ? { field: item.field, requested: item.requested, status: 'applied' }
              : {
                  field: item.field,
                  requested: item.requested,
                  status: 'failed',
                  detail: `${FIELD_LABELS[item.field] ?? item.field}: ${explainGphoto2Error(single)}`,
                },
          );
        }
      }
    }

    return {
      ok: outcomes.every((outcome) => outcome.status === 'applied'),
      outcomes,
      elapsedMs: Date.now() - started,
    };
  }

  async triggerCapture(): Promise<void> {
    if (!this.connected) throw new CameraNotConnectedError();
    // --trigger-capture はシャッターを切るだけで転送を待たない。
    // 画像はカメラのカードに残るので、撮影のテンポを止めない。
    const result = await this.runner.run(['--trigger-capture']);
    if (result.code !== 0) throw new Error(explainGphoto2Error(result));
  }

  /** 解決済みマッピング（診断・probe 用）。 */
  getMappingReport(): MappingReport | undefined {
    return this.lastReport;
  }

  // --- 内部 ---------------------------------------------------------------

  /** 保存済みマッピングを読むか、実機から解決して保存する。 */
  private async loadMapping(): Promise<void> {
    const mappingPath = this.options.mappingPath;

    if (mappingPath && !this.options.alwaysRescan) {
      try {
        const stored = JSON.parse(await readFile(mappingPath, 'utf8')) as StoredMapping;
        if (Array.isArray(stored.resolved) && stored.resolved.length > 0) {
          this.mapping = new Map(stored.resolved.map((entry) => [entry.field, entry]));
          this.lastReport = { resolved: stored.resolved, unresolved: [] };
          this.log(`保存済みマッピングを読み込みました (${stored.resolved.length}項目, ${mappingPath})`);
          return;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.log(`マッピングの読み込みに失敗したため実機から解決し直します: ${String(error)}`);
        }
      }
    }

    const report = await this.scan();
    this.mapping = new Map(report.resolved.map((entry) => [entry.field, entry]));
    this.lastReport = report;
    this.log(
      `実機から ${report.resolved.length} 項目を解決しました` +
        (report.unresolved.length > 0 ? `（未解決 ${report.unresolved.length} 項目）` : ''),
    );

    if (mappingPath) {
      await this.saveMapping(mappingPath, report);
    }
  }

  /** 実機の設定ツリーを読んでマッピングを解決する。 */
  async scan(): Promise<MappingReport> {
    const result = await this.runner.run(['--list-all-config']);
    if (result.code !== 0) throw new Error(explainGphoto2Error(result));
    return resolveMapping(parseConfigList(result.stdout));
  }

  private async saveMapping(mappingPath: string, report: MappingReport): Promise<void> {
    const stored: StoredMapping = {
      savedAt: new Date().toISOString(),
      model: this.model ?? 'unknown',
      resolved: report.resolved,
    };
    await mkdir(path.dirname(mappingPath), { recursive: true });
    await writeFile(mappingPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8');
    this.log(`マッピングを保存しました: ${mappingPath}`);
  }

  /**
   * 主要な設定の現在値を読む。1 プロセスにまとめて往復を減らす。
   *
   * 失敗は 2 種類あり、区別して返す:
   *   - 通信レベルの失敗（カメラが抜けた・応答しない） → disconnected
   *   - 個々の項目が読めないだけ                      → settings が部分的に埋まる
   */
  private async readCurrentSettings(): Promise<{
    settings?: ShootingSettings;
    disconnected?: boolean;
    error?: string;
  }> {
    const wanted: (keyof ShootingSettings)[] = [
      'aperture',
      'shutterSpeedSec',
      'iso',
      'exposureCompensation',
      'exposureMode',
      'filmSimulation',
      'whiteBalance',
    ];
    const paths = wanted
      .map((field) => this.mapping.get(field))
      .filter((entry): entry is ResolvedField => entry !== undefined);
    if (paths.length === 0) return {};

    const result = await this.runner.run(paths.flatMap((entry) => ['--get-config', entry.path]));
    if (result.code !== 0) {
      const combined = `${result.stderr}\n${result.stdout}`;
      const lost = /No camera found|Could not detect any camera|Could not (open|initialize) the camera|PTP I\/O Error|Could not (claim|lock) the usb device/i.test(
        combined,
      );
      return { disconnected: lost, error: explainGphoto2Error(result) };
    }

    const entries = parseConfigList(result.stdout);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    const settings: ShootingSettings = {};

    for (const resolved of paths) {
      // --get-config はパスの先頭が省略される版があるため、末尾一致でも探す。
      const entry =
        byPath.get(resolved.path) ??
        entries.find((candidate) => candidate.name === resolved.path.split('/').pop());
      if (!entry) continue;
      this.assignCurrent(settings, resolved, entry.current);
    }

    return { ...(Object.keys(settings).length > 0 ? { settings } : {}) };
  }

  /** 実機が返した現在値を、ドメインの型へ戻す。 */
  private assignCurrent(
    settings: ShootingSettings,
    resolved: ResolvedField,
    current: string,
  ): void {
    const matched = resolved.choices.find((choice) => choice.value === current);

    switch (resolved.kind) {
      case 'aperture':
        if (typeof matched?.parsed === 'number') settings.aperture = matched.parsed;
        break;
      case 'shutter':
        if (typeof matched?.parsed === 'number') settings.shutterSpeedSec = matched.parsed;
        break;
      case 'iso':
        if (matched?.parsed !== undefined) settings.iso = matched.parsed;
        break;
      case 'expcomp':
        if (typeof matched?.parsed === 'number') settings.exposureCompensation = matched.parsed;
        break;
      case 'enum': {
        if (!matched || !resolved.valueMap) break;
        const domainValue = Object.entries(resolved.valueMap).find(
          ([, index]) => index === matched.index,
        )?.[0];
        if (domainValue) {
          (settings as Record<string, unknown>)[resolved.field] = domainValue;
        }
        break;
      }
      default:
        break;
    }
  }

  private async readBatteryPercent(): Promise<number | undefined> {
    const result = await this.runner.run(['--get-config', '/main/status/batterylevel']);
    if (result.code !== 0) return undefined;
    const entry = parseConfigList(result.stdout)[0];
    if (!entry) return undefined;
    const match = /(\d+)/.exec(entry.current);
    return match ? Number(match[1]) : undefined;
  }

  /**
   * カメラが今選んでいる露出から被写体輝度（EV100）を逆算する。
   *
   * 専用の測光値プロパティが無いため、これが実用上いちばん確実な取得方法。
   * ISO が AUTO 表示のままだと逆算できないので、その場合は諦める。
   */
  private deriveMeteredEv(current: ShootingSettings | undefined): number | undefined {
    if (!current) return undefined;
    const { aperture, shutterSpeedSec, iso, exposureCompensation } = current;
    if (typeof aperture !== 'number' || typeof shutterSpeedSec !== 'number') return undefined;
    if (typeof iso !== 'number') return undefined;
    const ev = settingsEv(aperture, shutterSpeedSec, iso);
    // 露出補正がかかっている分は、被写体輝度ではなく撮影者の意図なので戻す。
    return Math.round((ev + (exposureCompensation ?? 0)) * 10) / 10;
  }

  private log(message: string): void {
    this.options.logger?.(message);
  }
}
