/**
 * Wi-Fi（PTP/IP）経由のカメラアダプタ。
 *
 * カメラを Wi-Fi 接続状態にし、同じネットワーク上のこのサーバから設定を書き込む。
 * 富士フイルム独自プロパティは実機検証が必要なため、
 * 書き込みに失敗しても他のフィールドは続行し、結果を outcomes に残す。
 */
import { readFile } from 'node:fs/promises';
import { PtpIpClient, PtpIpError, type PtpIpClientOptions } from './client.js';
import {
  DEFAULT_BINDINGS,
  applyOverrides,
  bindingsByField,
  type PropertyBinding,
  type PropertyOverride,
} from './fujiProps.js';
import { FIELD_LABELS } from '../../domain/labels.js';
import type { ShootingSettings } from '../../domain/types.js';
import type { ApplyOutcome, ApplyResult, CameraAdapter, CameraStatus } from '../types.js';
import { CameraNotConnectedError } from '../types.js';

export interface PtpIpAdapterOptions extends PtpIpClientOptions {
  /** 独自プロパティの上書き定義 JSON のパス。 */
  propertyOverridePath?: string;
  /**
   * 確度が 'unverified' のプロパティも送信するか。
   * 既定は false（実機検証前に予期しない値を書き込むのを避ける）。
   */
  allowUnverified?: boolean;
}

export class PtpIpCamera implements CameraAdapter {
  readonly transport = 'ptpip';
  private client: PtpIpClient;
  private bindings = bindingsByField(DEFAULT_BINDINGS);
  private connectedModel?: string;

  constructor(private readonly options: PtpIpAdapterOptions = {}) {
    this.client = new PtpIpClient(options);
  }

  /** JSON の上書き定義を読み込む。ファイルが無ければ既定表のまま。 */
  async loadOverrides(): Promise<void> {
    if (!this.options.propertyOverridePath) return;
    try {
      const raw = await readFile(this.options.propertyOverridePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, PropertyOverride>;
      this.bindings = bindingsByField(applyOverrides(DEFAULT_BINDINGS, parsed));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async connect(): Promise<CameraStatus> {
    await this.loadOverrides();
    this.client = new PtpIpClient(this.options);
    await this.client.connect();
    this.connectedModel = 'X100VI';
    return this.getStatus();
  }

  async disconnect(): Promise<void> {
    await this.client.close();
    this.connectedModel = undefined;
  }

  async getStatus(): Promise<CameraStatus> {
    return {
      connected: this.client.connected,
      model: this.client.connected ? this.connectedModel : undefined,
      transport: this.transport,
    };
  }

  async applySettings(settings: ShootingSettings): Promise<ApplyResult> {
    if (!this.client.connected) throw new CameraNotConnectedError();
    const started = Date.now();
    const outcomes: ApplyOutcome[] = [];

    for (const [field, value] of Object.entries(settings) as [keyof ShootingSettings, unknown][]) {
      if (value === undefined) continue;
      const binding = this.bindings.get(field);

      if (!binding) {
        outcomes.push({
          field,
          requested: value,
          status: 'unsupported',
          detail: `${FIELD_LABELS[field] ?? field} に対応するPTPプロパティが未定義です。config/fuji-properties.json で定義してください。`,
        });
        continue;
      }

      if (binding.confidence === 'unverified' && !this.options.allowUnverified) {
        outcomes.push({
          field,
          requested: value,
          status: 'unsupported',
          detail: `${FIELD_LABELS[field] ?? field} のプロパティコードは実機未検証のため送信をスキップしました（--allow-unverified で送信できます）。`,
        });
        continue;
      }

      const encoded = binding.encode(value, settings);
      if (encoded === null) {
        outcomes.push({
          field,
          requested: value,
          status: 'unsupported',
          detail: `${FIELD_LABELS[field] ?? field} の値「${String(value)}」に対応するPTP値が定義されていません。`,
        });
        continue;
      }

      try {
        await this.client.setDevicePropValue(binding.code, binding.dataType, encoded);
        outcomes.push({ field, requested: value, status: 'applied' });
      } catch (error) {
        outcomes.push({
          field,
          requested: value,
          status: 'failed',
          detail:
            error instanceof PtpIpError
              ? `${FIELD_LABELS[field] ?? field}: ${error.message}`
              : String(error),
        });
      }
    }

    return {
      ok: outcomes.every((o) => o.status === 'applied'),
      outcomes,
      elapsedMs: Date.now() - started,
    };
  }

  async triggerCapture(): Promise<void> {
    if (!this.client.connected) throw new CameraNotConnectedError();
    await this.client.triggerCapture();
  }

  /** 現在有効なバインディング（診断用）。 */
  listBindings(): PropertyBinding[] {
    return [...this.bindings.values()];
  }
}
