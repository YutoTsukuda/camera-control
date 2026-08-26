/**
 * 公式 FUJIFILM Camera Remote SDK ブリッジ経由のアダプタ。
 *
 * 公式 SDK は C++ のネイティブライブラリで Node から直接は呼べないため、
 * SDK をラップした小さな HTTP サーバ（別プロセス）を立てて、そこへ委譲する。
 * リバースエンジニアリングに依存しないので、本番運用ではこちらが推奨経路。
 *
 * ブリッジ側に期待する API:
 *   GET  /status                 → { connected, model, batteryPercent, current, meteredEv100 }
 *   POST /connect                → { connected, model, ... }
 *   POST /disconnect             → 204
 *   POST /settings  { ...差分 }  → { outcomes: [{ field, status, detail }] }
 *   POST /capture                → 204
 */
import type { ShootingSettings } from '../domain/types.js';
import type { ApplyOutcome, ApplyResult, CameraAdapter, CameraStatus } from './types.js';

export interface SdkBridgeOptions {
  /** 例: http://127.0.0.1:8787 */
  baseUrl: string;
  timeoutMs?: number;
}

export class SdkBridgeCamera implements CameraAdapter {
  readonly transport = 'sdk-bridge';

  constructor(private readonly options: SdkBridgeOptions) {}

  async connect(): Promise<CameraStatus> {
    return this.request<CameraStatus>('POST', '/connect');
  }

  async disconnect(): Promise<void> {
    await this.request<void>('POST', '/disconnect');
  }

  async getStatus(): Promise<CameraStatus> {
    const status = await this.request<CameraStatus>('GET', '/status');
    return { ...status, transport: this.transport };
  }

  async applySettings(settings: ShootingSettings): Promise<ApplyResult> {
    const started = Date.now();
    const body = await this.request<{ outcomes: ApplyOutcome[] }>('POST', '/settings', settings);
    const outcomes = body.outcomes ?? [];
    return {
      ok: outcomes.every((o) => o.status === 'applied'),
      outcomes,
      elapsedMs: Date.now() - started,
    };
  }

  async triggerCapture(): Promise<void> {
    await this.request<void>('POST', '/capture');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000);
    try {
      const response = await fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`SDKブリッジがエラーを返しました (HTTP ${response.status})`);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('SDKブリッジへの要求がタイムアウトしました。');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
