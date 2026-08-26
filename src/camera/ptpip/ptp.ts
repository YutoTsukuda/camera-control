/**
 * PTP（Picture Transfer Protocol）のオペレーション層。
 * パケット層の上で、オペレーション要求・データフェーズ・応答を組み立てる。
 */
import { PacketType, encodePacket } from './packet.js';

export enum OperationCode {
  GetDeviceInfo = 0x1001,
  OpenSession = 0x1002,
  CloseSession = 0x1003,
  GetDevicePropDesc = 0x1014,
  GetDevicePropValue = 0x1015,
  SetDevicePropValue = 0x1016,
  InitiateCapture = 0x100e,
}

export enum ResponseCode {
  Undefined = 0x2000,
  OK = 0x2001,
  GeneralError = 0x2002,
  SessionNotOpen = 0x2003,
  OperationNotSupported = 0x2005,
  ParameterNotSupported = 0x2006,
  InvalidDevicePropFormat = 0x2009,
  DeviceBusy = 0x2019,
  InvalidDevicePropValue = 0x201a,
  AccessDenied = 0x200f,
}

export function describeResponseCode(code: number): string {
  switch (code) {
    case ResponseCode.OK:
      return 'OK';
    case ResponseCode.SessionNotOpen:
      return 'セッションが開かれていません。';
    case ResponseCode.OperationNotSupported:
      return 'この操作はカメラが対応していません。';
    case ResponseCode.InvalidDevicePropValue:
      return 'その値はカメラが受け付けません（撮影モードやダイヤル位置の制約の可能性）。';
    case ResponseCode.InvalidDevicePropFormat:
      return '値のデータ型が一致しません。';
    case ResponseCode.DeviceBusy:
      return 'カメラがビジー状態です。';
    case ResponseCode.AccessDenied:
      return 'カメラ側で操作が拒否されました（ダイヤルが物理位置に固定されている可能性）。';
    default:
      return `PTPエラー 0x${code.toString(16)}`;
  }
}

/** データフェーズの向き。 */
export enum DataPhase {
  None = 1,
  DataOut = 2,
  DataIn = 3,
}

export function encodeOperationRequest(
  dataPhase: DataPhase,
  operationCode: OperationCode | number,
  transactionId: number,
  params: number[] = [],
): Buffer {
  const payload = Buffer.alloc(10 + params.length * 4);
  payload.writeUInt32LE(dataPhase, 0);
  payload.writeUInt16LE(operationCode, 4);
  payload.writeUInt32LE(transactionId, 6);
  params.forEach((param, i) => payload.writeUInt32LE(param >>> 0, 10 + i * 4));
  return encodePacket(PacketType.OperationRequest, payload);
}

export interface OperationResponse {
  responseCode: number;
  transactionId: number;
  params: number[];
}

export function decodeOperationResponse(payload: Buffer): OperationResponse {
  const responseCode = payload.readUInt16LE(0);
  const transactionId = payload.readUInt32LE(2);
  const params: number[] = [];
  for (let offset = 6; offset + 4 <= payload.length; offset += 4) {
    params.push(payload.readUInt32LE(offset));
  }
  return { responseCode, transactionId, params };
}

/**
 * データフェーズ（StartData → Data → EndData）のパケット列を作る。
 * 設定値の書き込みは数バイトなので分割はしないが、形式は仕様通りに保つ。
 */
export function encodeDataPhase(transactionId: number, data: Buffer): Buffer[] {
  const start = Buffer.alloc(12);
  start.writeUInt32LE(transactionId, 0);
  start.writeBigUInt64LE(BigInt(data.length), 4);

  const end = Buffer.alloc(4 + data.length);
  end.writeUInt32LE(transactionId, 0);
  data.copy(end, 4);

  return [encodePacket(PacketType.StartData, start), encodePacket(PacketType.EndData, end)];
}

/** Data / EndData パケットのペイロードから中身を取り出す。 */
export function decodeDataPayload(payload: Buffer): Buffer {
  return payload.subarray(4);
}

/** PTP のデータ型コード（本システムで使うものだけ）。 */
export enum PtpDataType {
  INT8 = 0x0001,
  UINT8 = 0x0002,
  INT16 = 0x0003,
  UINT16 = 0x0004,
  INT32 = 0x0005,
  UINT32 = 0x0006,
  INT64 = 0x0007,
  UINT64 = 0x0008,
  STRING = 0xffff,
}

export function encodePropValue(dataType: PtpDataType, value: number): Buffer {
  switch (dataType) {
    case PtpDataType.INT8: {
      const b = Buffer.alloc(1);
      b.writeInt8(value);
      return b;
    }
    case PtpDataType.UINT8: {
      const b = Buffer.alloc(1);
      b.writeUInt8(value & 0xff);
      return b;
    }
    case PtpDataType.INT16: {
      const b = Buffer.alloc(2);
      b.writeInt16LE(value);
      return b;
    }
    case PtpDataType.UINT16: {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(value & 0xffff);
      return b;
    }
    case PtpDataType.INT32: {
      const b = Buffer.alloc(4);
      b.writeInt32LE(value | 0);
      return b;
    }
    case PtpDataType.UINT32: {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(value >>> 0);
      return b;
    }
    default:
      throw new Error(`未対応のPTPデータ型: 0x${dataType.toString(16)}`);
  }
}

export function decodePropValue(dataType: PtpDataType, buf: Buffer): number {
  switch (dataType) {
    case PtpDataType.INT8:
      return buf.readInt8(0);
    case PtpDataType.UINT8:
      return buf.readUInt8(0);
    case PtpDataType.INT16:
      return buf.readInt16LE(0);
    case PtpDataType.UINT16:
      return buf.readUInt16LE(0);
    case PtpDataType.INT32:
      return buf.readInt32LE(0);
    case PtpDataType.UINT32:
      return buf.readUInt32LE(0);
    default:
      throw new Error(`未対応のPTPデータ型: 0x${dataType.toString(16)}`);
  }
}
