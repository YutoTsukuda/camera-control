/**
 * カメラ制御の抽象。
 *
 * 接続方式（Wi-Fi の PTP/IP、公式 Camera Remote SDK のブリッジ、モック）を
 * この 1 つのインタフェースの裏に隠す。上位層（AI・サーバ・UI）は
 * どの経路で繋がっているかを一切知らない。
 */
import type { ShootingSettings } from '../domain/types.js';

export interface CameraStatus {
  connected: boolean;
  /** 例: 'X100VI'。未接続なら undefined。 */
  model?: string;
  /** 接続方式の識別子。 */
  transport: string;
  /** バッテリー残量[%]。取得できない場合は undefined。 */
  batteryPercent?: number;
  /** 現在カメラに設定されている値（取得できた範囲）。 */
  current?: ShootingSettings;
  /** カメラ測光値の ISO100 換算 EV。対応していれば入る。 */
  meteredEv100?: number;
  /** 最後のエラー。 */
  lastError?: string;
}

export interface ApplyOutcome {
  field: keyof ShootingSettings;
  requested: unknown;
  status: 'applied' | 'unsupported' | 'failed';
  /** 失敗・非対応の理由（日本語）。 */
  detail?: string;
}

export interface ApplyResult {
  ok: boolean;
  outcomes: ApplyOutcome[];
  /** 適用にかかった時間[ms]。 */
  elapsedMs: number;
}

export interface CameraAdapter {
  readonly transport: string;
  connect(): Promise<CameraStatus>;
  disconnect(): Promise<void>;
  getStatus(): Promise<CameraStatus>;
  /**
   * 設定を適用する。undefined のフィールドは触らない（差分適用）。
   * 一部が失敗しても残りは適用を試み、結果を outcomes にまとめて返す。
   */
  applySettings(settings: ShootingSettings): Promise<ApplyResult>;
  /** 対応していればシャッターを切る。 */
  triggerCapture?(): Promise<void>;
}

export class CameraNotConnectedError extends Error {
  constructor() {
    super('カメラに接続されていません。');
    this.name = 'CameraNotConnectedError';
  }
}
