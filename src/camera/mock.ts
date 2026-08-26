/**
 * モックカメラ。
 *
 * 実機が無くても UI とロジックを一通り動かせるようにするためのもの。
 * 単なるスタブではなく、
 *   - 明るさが時間帯で変わる測光値を返す
 *   - 設定できない値を拒否する
 *   - 通信遅延を模す
 * まで作り込んであるので、実機で起きる失敗の多くはここで再現できる。
 */
import { APERTURES, ISO_ALL, fastestShutterSec } from '../domain/capabilities.js';
import { formatShutter } from '../domain/exposure.js';
import type { ShootingSettings } from '../domain/types.js';
import type { ApplyOutcome, ApplyResult, CameraAdapter, CameraStatus } from './types.js';
import { CameraNotConnectedError } from './types.js';

export interface MockCameraOptions {
  /** 1項目あたりの疑似通信遅延[ms]。既定 15ms。 */
  latencyMs?: number;
  /** 固定の測光値。省略時は時刻から生成する。 */
  meteredEv100?: number;
  /** 指定フィールドを常に失敗させる（エラー処理のテスト用）。 */
  failFields?: (keyof ShootingSettings)[];
}

/** 時刻から屋外相当の明るさをそれらしく生成する。 */
function simulatedEv(now = new Date()): number {
  const hour = now.getHours() + now.getMinutes() / 60;
  if (hour >= 10 && hour < 15) return 15;
  if (hour >= 8 && hour < 17) return 13.5;
  if (hour >= 6 && hour < 19) return 10;
  if (hour >= 19 && hour < 21) return 6;
  return 4;
}

export class MockCamera implements CameraAdapter {
  readonly transport = 'mock';
  private connected = false;
  private state: ShootingSettings = {
    exposureMode: 'A',
    aperture: 5.6,
    shutterSpeedSec: 1 / 125,
    iso: 'AUTO',
    isoAutoMax: 6400,
    isoAutoMinShutterSec: 1 / 60,
    exposureCompensation: 0,
    shutterType: 'MS',
    ndFilter: 'OFF',
    filmSimulation: 'PROVIA_STD',
    whiteBalance: 'AUTO',
    dynamicRange: 'DR_AUTO',
    meteringMode: 'MULTI',
    focusMode: 'AF_S',
    afArea: 'SINGLE_POINT',
    subjectDetection: 'OFF',
    driveMode: 'SINGLE',
    imageQuality: 'FINE',
    digitalTeleconverter: 'OFF',
  };

  constructor(private readonly options: MockCameraOptions = {}) {}

  async connect(): Promise<CameraStatus> {
    await this.delay(120);
    this.connected = true;
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async getStatus(): Promise<CameraStatus> {
    return {
      connected: this.connected,
      model: this.connected ? 'X100VI (mock)' : undefined,
      transport: this.transport,
      batteryPercent: this.connected ? 78 : undefined,
      current: this.connected ? { ...this.state } : undefined,
      meteredEv100: this.connected ? (this.options.meteredEv100 ?? simulatedEv()) : undefined,
    };
  }

  async applySettings(settings: ShootingSettings): Promise<ApplyResult> {
    if (!this.connected) throw new CameraNotConnectedError();
    const started = Date.now();
    const outcomes: ApplyOutcome[] = [];
    const failFields = new Set(this.options.failFields ?? []);

    for (const [key, value] of Object.entries(settings) as [keyof ShootingSettings, unknown][]) {
      if (value === undefined) continue;
      await this.delay(this.options.latencyMs ?? 15);

      if (failFields.has(key)) {
        outcomes.push({ field: key, requested: value, status: 'failed', detail: '疑似的な書き込み失敗。' });
        continue;
      }

      const rejection = this.reject(key, value, settings);
      if (rejection) {
        outcomes.push({ field: key, requested: value, status: 'unsupported', detail: rejection });
        continue;
      }

      (this.state as Record<string, unknown>)[key] = value;
      outcomes.push({ field: key, requested: value, status: 'applied' });
    }

    return {
      ok: outcomes.every((o) => o.status === 'applied'),
      outcomes,
      elapsedMs: Date.now() - started,
    };
  }

  async triggerCapture(): Promise<void> {
    if (!this.connected) throw new CameraNotConnectedError();
    await this.delay(200);
  }

  /** カメラ側が受け付けない値をここで模擬的に弾く。 */
  private reject(
    key: keyof ShootingSettings,
    value: unknown,
    incoming: ShootingSettings,
  ): string | undefined {
    if (key === 'aperture' && typeof value === 'number' && !APERTURES.includes(value)) {
      return `F${value} は選択できません。`;
    }
    if (key === 'iso' && typeof value === 'number' && !ISO_ALL.includes(value)) {
      return `ISO ${value} は選択できません。`;
    }
    if (key === 'shutterSpeedSec' && typeof value === 'number') {
      const aperture = incoming.aperture ?? (this.state.aperture as number);
      const type = incoming.shutterType ?? this.state.shutterType ?? 'MS';
      const fastest = fastestShutterSec(type, aperture);
      if (value < fastest - 1e-12) {
        return `${formatShutter(value)} は F${aperture} の ${type} では切れません（上限 ${formatShutter(fastest)}）。`;
      }
    }
    return undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
