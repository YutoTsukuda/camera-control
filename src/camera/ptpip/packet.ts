/**
 * PTP/IP のパケット層。
 *
 * フレーム形式は「4バイトLEの全長（この4バイトを含む）+ 4バイトLEのパケット種別 + ペイロード」。
 * 富士フイルムの無線プロトコルはこの PTP/IP を土台にしている。
 * ここは仕様が明快でハードウェア無しに検証できるため、単体テストで固めてある。
 */

export enum PacketType {
  InitCommandRequest = 1,
  InitCommandAck = 2,
  InitEventRequest = 3,
  InitEventAck = 4,
  InitFail = 5,
  OperationRequest = 6,
  OperationResponse = 7,
  Event = 8,
  StartData = 9,
  Data = 10,
  Cancel = 11,
  EndData = 12,
  Ping = 13,
  Pong = 14,
}

export interface Packet {
  type: PacketType;
  payload: Buffer;
}

/** ヘッダ（長さ4 + 種別4）のバイト数。 */
export const HEADER_SIZE = 8;

export function encodePacket(type: PacketType, payload: Buffer = Buffer.alloc(0)): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE + payload.length);
  buf.writeUInt32LE(buf.length, 0);
  buf.writeUInt32LE(type, 4);
  payload.copy(buf, HEADER_SIZE);
  return buf;
}

/**
 * TCP は境界を保証しないので、届いたバイト列を貯めながら
 * 完全なパケットになったぶんだけ取り出す。
 */
export class PacketReader {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Packet[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const packets: Packet[] = [];

    while (this.buffer.length >= HEADER_SIZE) {
      const length = this.buffer.readUInt32LE(0);
      if (length < HEADER_SIZE) {
        // 壊れたストリーム。復帰できないので捨てて例外にする。
        this.buffer = Buffer.alloc(0);
        throw new Error(`不正なPTP/IPパケット長: ${length}`);
      }
      if (this.buffer.length < length) break;
      packets.push({
        type: this.buffer.readUInt32LE(4) as PacketType,
        payload: this.buffer.subarray(HEADER_SIZE, length),
      });
      this.buffer = this.buffer.subarray(length);
    }
    return packets;
  }

  /** 未消化のバイト数（デバッグ用）。 */
  get pending(): number {
    return this.buffer.length;
  }
}

/** PTP の文字列表現（UTF-16LE、NUL終端）を書き出す。 */
export function encodeUtf16z(value: string): Buffer {
  return Buffer.from(`${value}\0`, 'utf16le');
}

/** UTF-16LE NUL終端文字列を読み出し、次のオフセットを返す。 */
export function decodeUtf16z(buf: Buffer, offset: number): { value: string; next: number } {
  for (let i = offset; i + 1 < buf.length; i += 2) {
    if (buf.readUInt16LE(i) === 0) {
      return { value: buf.subarray(offset, i).toString('utf16le'), next: i + 2 };
    }
  }
  return { value: buf.subarray(offset).toString('utf16le'), next: buf.length };
}

/** InitCommandRequest のペイロード（GUID 16バイト + クライアント名）。 */
export function encodeInitCommandRequest(guid: Buffer, friendlyName: string): Buffer {
  if (guid.length !== 16) throw new Error('GUID は16バイトである必要があります。');
  return Buffer.concat([guid, encodeUtf16z(friendlyName)]);
}

export interface InitCommandAck {
  connectionNumber: number;
  guid: Buffer;
  friendlyName: string;
}

export function decodeInitCommandAck(payload: Buffer): InitCommandAck {
  if (payload.length < 20) throw new Error('InitCommandAck が短すぎます。');
  const connectionNumber = payload.readUInt32LE(0);
  const guid = payload.subarray(4, 20);
  const { value } = decodeUtf16z(payload, 20);
  return { connectionNumber, guid, friendlyName: value };
}
