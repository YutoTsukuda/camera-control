/**
 * PTP/IP クライアント（TCP）。
 *
 * PTP は 1 コネクション上で 1 トランザクションずつ順に処理するプロトコルなので、
 * ここでも操作を直列化する。並行に投げると transactionId の対応が壊れる。
 */
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import {
  PacketReader,
  PacketType,
  decodeInitCommandAck,
  encodeInitCommandRequest,
  encodePacket,
  type Packet,
} from './packet.js';
import {
  DataPhase,
  OperationCode,
  PtpDataType,
  ResponseCode,
  decodeDataPayload,
  decodeOperationResponse,
  decodePropValue,
  describeResponseCode,
  encodeDataPhase,
  encodeOperationRequest,
  encodePropValue,
} from './ptp.js';

export interface PtpIpClientOptions {
  host?: string;
  /** コマンドチャンネル。富士フイルム機の既定は 55740。 */
  port?: number;
  /** カメラ側の一覧に表示されるクライアント名。 */
  friendlyName?: string;
  connectTimeoutMs?: number;
  operationTimeoutMs?: number;
  /** true にすると実際には送信せず、送るはずのフレームを onFrame に流すだけ。 */
  dryRun?: boolean;
  onFrame?: (direction: 'tx' | 'rx', packet: Packet) => void;
  logger?: (message: string) => void;
}

export class PtpIpError extends Error {
  constructor(
    message: string,
    readonly responseCode?: number,
  ) {
    super(message);
    this.name = 'PtpIpError';
  }
}

interface PendingTransaction {
  transactionId: number;
  data: Buffer[];
  resolve: (value: { responseCode: number; data: Buffer }) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class PtpIpClient {
  private socket?: net.Socket;
  private readonly reader = new PacketReader();
  private transactionId = 1;
  private pending?: PendingTransaction;
  private queue: Promise<unknown> = Promise.resolve();
  private sessionOpen = false;

  readonly host: string;
  readonly port: number;

  constructor(private readonly options: PtpIpClientOptions = {}) {
    this.host = options.host ?? '192.168.0.1';
    this.port = options.port ?? 55740;
  }

  get connected(): boolean {
    return this.options.dryRun === true || (this.socket !== undefined && !this.socket.destroyed);
  }

  async connect(): Promise<void> {
    if (this.options.dryRun) {
      this.log('dry-run: 実際の接続は行いません。');
      this.sessionOpen = true;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new PtpIpError(`${this.host}:${this.port} への接続がタイムアウトしました。`));
      }, this.options.connectTimeoutMs ?? 5000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        socket.setNoDelay(true);
        this.socket = socket;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (err) => this.failPending(new PtpIpError(`通信エラー: ${err.message}`)));
        socket.on('close', () => this.failPending(new PtpIpError('接続が切断されました。')));
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timeout);
        reject(new PtpIpError(`接続に失敗しました: ${err.message}`));
      });
    });

    await this.handshake();
    await this.openSession();
  }

  /**
   * PTP/IP の初期化。
   * カメラ側で「接続を許可しますか？」の確認が出る機種があるため、
   * 初回はカメラの画面を見ながら実行すること。
   */
  private async handshake(): Promise<void> {
    const guid = randomBytes(16);
    const name = this.options.friendlyName ?? 'X100VI-AI-Assistant';
    const ack = await this.sendAndAwait(
      encodePacket(PacketType.InitCommandRequest, encodeInitCommandRequest(guid, name)),
      PacketType.InitCommandAck,
      this.options.connectTimeoutMs ?? 5000,
    );
    const info = decodeInitCommandAck(ack.payload);
    this.log(`接続成立: ${info.friendlyName} (connection #${info.connectionNumber})`);
  }

  private async openSession(): Promise<void> {
    const result = await this.transact(DataPhase.None, OperationCode.OpenSession, [1]);
    if (result.responseCode !== ResponseCode.OK) {
      throw new PtpIpError(
        `セッションを開けませんでした: ${describeResponseCode(result.responseCode)}`,
        result.responseCode,
      );
    }
    this.sessionOpen = true;
  }

  async close(): Promise<void> {
    try {
      if (this.sessionOpen && !this.options.dryRun) {
        await this.transact(DataPhase.None, OperationCode.CloseSession, []);
      }
    } catch {
      // 切断時のエラーは握りつぶす（すでに切れている場合が大半）
    } finally {
      this.sessionOpen = false;
      this.socket?.destroy();
      this.socket = undefined;
    }
  }

  /** デバイスプロパティを書き込む。 */
  async setDevicePropValue(code: number, dataType: PtpDataType, value: number): Promise<void> {
    const payload = encodePropValue(dataType, value);
    const result = await this.transact(DataPhase.DataOut, OperationCode.SetDevicePropValue, [code], payload);
    if (result.responseCode !== ResponseCode.OK) {
      throw new PtpIpError(describeResponseCode(result.responseCode), result.responseCode);
    }
  }

  /** デバイスプロパティを読み出す。 */
  async getDevicePropValue(code: number, dataType: PtpDataType): Promise<number> {
    const result = await this.transact(DataPhase.DataIn, OperationCode.GetDevicePropValue, [code]);
    if (result.responseCode !== ResponseCode.OK) {
      throw new PtpIpError(describeResponseCode(result.responseCode), result.responseCode);
    }
    return decodePropValue(dataType, result.data);
  }

  /** GetDeviceInfo の生データ。対応プロパティの調査に使う。 */
  async getDeviceInfoRaw(): Promise<Buffer> {
    const result = await this.transact(DataPhase.DataIn, OperationCode.GetDeviceInfo, []);
    if (result.responseCode !== ResponseCode.OK) {
      throw new PtpIpError(describeResponseCode(result.responseCode), result.responseCode);
    }
    return result.data;
  }

  async triggerCapture(): Promise<void> {
    const result = await this.transact(DataPhase.None, OperationCode.InitiateCapture, [0, 0]);
    if (result.responseCode !== ResponseCode.OK) {
      throw new PtpIpError(describeResponseCode(result.responseCode), result.responseCode);
    }
  }

  /** 1 トランザクションを直列に実行する。 */
  private transact(
    dataPhase: DataPhase,
    operationCode: OperationCode,
    params: number[],
    outgoingData?: Buffer,
  ): Promise<{ responseCode: number; data: Buffer }> {
    const run = async (): Promise<{ responseCode: number; data: Buffer }> => {
      const transactionId = this.transactionId++;
      const frames = [encodeOperationRequest(dataPhase, operationCode, transactionId, params)];
      if (dataPhase === DataPhase.DataOut && outgoingData) {
        frames.push(...encodeDataPhase(transactionId, outgoingData));
      }

      if (this.options.dryRun) {
        for (const frame of frames) {
          this.emitFrame('tx', frame);
        }
        return { responseCode: ResponseCode.OK, data: Buffer.alloc(0) };
      }

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = undefined;
          reject(new PtpIpError('カメラからの応答がタイムアウトしました。'));
        }, this.options.operationTimeoutMs ?? 8000);

        this.pending = { transactionId, data: [], resolve, reject, timer };
        for (const frame of frames) {
          this.emitFrame('tx', frame);
          this.socket?.write(frame);
        }
      });
    };

    const result = this.queue.then(run, run);
    // キューはエラーで止めない（次の操作は独立して試せるようにする）
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** ハンドシェイクのように transactionId を持たないやり取り用。 */
  private sendAndAwait(frame: Buffer, expect: PacketType, timeoutMs: number): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshakeWaiter = undefined;
        reject(new PtpIpError('カメラからの初期応答がありません。カメラ側で接続を許可してください。'));
      }, timeoutMs);

      this.handshakeWaiter = { expect, resolve, reject, timer };
      this.emitFrame('tx', frame);
      this.socket?.write(frame);
    });
  }

  private handshakeWaiter?: {
    expect: PacketType;
    resolve: (packet: Packet) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  };

  private onData(chunk: Buffer): void {
    let packets: Packet[];
    try {
      packets = this.reader.push(chunk);
    } catch (error) {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    for (const packet of packets) {
      this.emitFrame('rx', undefined, packet);

      if (this.handshakeWaiter) {
        const waiter = this.handshakeWaiter;
        if (packet.type === waiter.expect) {
          clearTimeout(waiter.timer);
          this.handshakeWaiter = undefined;
          waiter.resolve(packet);
          continue;
        }
        if (packet.type === PacketType.InitFail) {
          clearTimeout(waiter.timer);
          this.handshakeWaiter = undefined;
          waiter.reject(new PtpIpError('カメラが接続を拒否しました（InitFail）。'));
          continue;
        }
      }

      switch (packet.type) {
        case PacketType.StartData:
          break;
        case PacketType.Data:
        case PacketType.EndData:
          this.pending?.data.push(decodeDataPayload(packet.payload));
          break;
        case PacketType.OperationResponse: {
          const response = decodeOperationResponse(packet.payload);
          const pending = this.pending;
          if (pending && pending.transactionId === response.transactionId) {
            clearTimeout(pending.timer);
            this.pending = undefined;
            pending.resolve({
              responseCode: response.responseCode,
              data: Buffer.concat(pending.data),
            });
          }
          break;
        }
        case PacketType.Ping:
          this.socket?.write(encodePacket(PacketType.Pong));
          break;
        default:
          break;
      }
    }
  }

  private failPending(error: Error): void {
    const pending = this.pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending = undefined;
      pending.reject(error);
    }
    const waiter = this.handshakeWaiter;
    if (waiter) {
      clearTimeout(waiter.timer);
      this.handshakeWaiter = undefined;
      waiter.reject(error);
    }
  }

  private emitFrame(direction: 'tx' | 'rx', raw?: Buffer, packet?: Packet): void {
    if (!this.options.onFrame) return;
    if (packet) {
      this.options.onFrame(direction, packet);
    } else if (raw && raw.length >= 8) {
      this.options.onFrame(direction, {
        type: raw.readUInt32LE(4) as PacketType,
        payload: raw.subarray(8),
      });
    }
  }

  private log(message: string): void {
    this.options.logger?.(message);
  }
}
