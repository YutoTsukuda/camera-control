import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HEADER_SIZE,
  PacketReader,
  PacketType,
  decodeInitCommandAck,
  decodeUtf16z,
  encodeInitCommandRequest,
  encodePacket,
  encodeUtf16z,
} from '../src/camera/ptpip/packet.js';
import {
  DataPhase,
  OperationCode,
  PtpDataType,
  decodeDataPayload,
  decodeOperationResponse,
  decodePropValue,
  encodeDataPhase,
  encodeOperationRequest,
  encodePropValue,
} from '../src/camera/ptpip/ptp.js';
import { parseDeviceInfo } from '../src/camera/ptpip/deviceInfo.js';

describe('PTP/IP パケット層', () => {
  it('長さと種別をリトルエンディアンで書く', () => {
    const packet = encodePacket(PacketType.Ping, Buffer.from([1, 2, 3]));
    assert.equal(packet.readUInt32LE(0), HEADER_SIZE + 3);
    assert.equal(packet.readUInt32LE(4), PacketType.Ping);
  });

  it('複数パケットが1チャンクで届いても分割できる', () => {
    const reader = new PacketReader();
    const chunk = Buffer.concat([
      encodePacket(PacketType.Ping),
      encodePacket(PacketType.Pong, Buffer.from('abc')),
    ]);
    const packets = reader.push(chunk);
    assert.equal(packets.length, 2);
    assert.equal(packets[0]?.type, PacketType.Ping);
    assert.equal(packets[1]?.payload.toString(), 'abc');
    assert.equal(reader.pending, 0);
  });

  it('1パケットが複数チャンクに分かれても再構成できる', () => {
    const reader = new PacketReader();
    const packet = encodePacket(PacketType.Data, Buffer.from('hello world'));
    assert.equal(reader.push(packet.subarray(0, 5)).length, 0);
    assert.equal(reader.push(packet.subarray(5, 10)).length, 0);
    const packets = reader.push(packet.subarray(10));
    assert.equal(packets.length, 1);
    assert.equal(packets[0]?.payload.toString(), 'hello world');
  });

  it('壊れた長さは例外にする', () => {
    const reader = new PacketReader();
    const broken = Buffer.alloc(8);
    broken.writeUInt32LE(3, 0);
    assert.throws(() => reader.push(broken), /不正なPTP\/IPパケット長/);
  });

  it('UTF-16LE NUL終端文字列を往復できる', () => {
    const encoded = encodeUtf16z('X100VI-テスト');
    const { value, next } = decodeUtf16z(encoded, 0);
    assert.equal(value, 'X100VI-テスト');
    assert.equal(next, encoded.length);
  });

  it('InitCommandRequest / Ack を往復できる', () => {
    const guid = Buffer.alloc(16, 7);
    const request = encodeInitCommandRequest(guid, 'client');
    assert.equal(request.length, 16 + 'client\0'.length * 2);

    const ackPayload = Buffer.concat([
      (() => {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(3, 0);
        return b;
      })(),
      guid,
      encodeUtf16z('X100VI'),
    ]);
    const ack = decodeInitCommandAck(ackPayload);
    assert.equal(ack.connectionNumber, 3);
    assert.equal(ack.friendlyName, 'X100VI');
  });

  it('GUIDが16バイトでなければ拒否する', () => {
    assert.throws(() => encodeInitCommandRequest(Buffer.alloc(8), 'x'), /16バイト/);
  });
});

describe('PTP オペレーション層', () => {
  it('OperationRequest のレイアウトが仕様通り', () => {
    const packet = encodeOperationRequest(
      DataPhase.DataOut,
      OperationCode.SetDevicePropValue,
      42,
      [0x5007],
    );
    const payload = packet.subarray(HEADER_SIZE);
    assert.equal(payload.readUInt32LE(0), DataPhase.DataOut);
    assert.equal(payload.readUInt16LE(4), OperationCode.SetDevicePropValue);
    assert.equal(payload.readUInt32LE(6), 42);
    assert.equal(payload.readUInt32LE(10), 0x5007);
  });

  it('OperationResponse を復号できる', () => {
    const payload = Buffer.alloc(10);
    payload.writeUInt16LE(0x2001, 0);
    payload.writeUInt32LE(42, 2);
    payload.writeUInt32LE(9, 6);
    const response = decodeOperationResponse(payload);
    assert.equal(response.responseCode, 0x2001);
    assert.equal(response.transactionId, 42);
    assert.deepEqual(response.params, [9]);
  });

  it('データフェーズは StartData と EndData を作る', () => {
    const data = Buffer.from([0x18, 0x01]);
    const [start, end] = encodeDataPhase(7, data);
    assert.equal(start?.readUInt32LE(4), PacketType.StartData);
    assert.equal(start?.readUInt32LE(HEADER_SIZE), 7);
    assert.equal(Number(start?.readBigUInt64LE(HEADER_SIZE + 4)), data.length);
    assert.equal(end?.readUInt32LE(4), PacketType.EndData);
    assert.deepEqual(decodeDataPayload(end!.subarray(HEADER_SIZE)), data);
  });

  it('プロパティ値の符号化と復号が往復する', () => {
    // F2.8 → 280 (uint16)
    assert.equal(decodePropValue(PtpDataType.UINT16, encodePropValue(PtpDataType.UINT16, 280)), 280);
    // 露出補正 -1/3EV → -333 (int16)
    assert.equal(decodePropValue(PtpDataType.INT16, encodePropValue(PtpDataType.INT16, -333)), -333);
    // 露光時間 1/250秒 → 40 (0.1ms単位, uint32)
    assert.equal(decodePropValue(PtpDataType.UINT32, encodePropValue(PtpDataType.UINT32, 40)), 40);
  });

  it('未対応のデータ型は例外にする', () => {
    assert.throws(() => encodePropValue(PtpDataType.STRING, 1), /未対応のPTPデータ型/);
  });
});

describe('DeviceInfo パーサ', () => {
  it('対応プロパティ一覧を取り出せる', () => {
    const ptpString = (value: string) => {
      const body = Buffer.from(`${value}\0`, 'utf16le');
      return Buffer.concat([Buffer.from([body.length / 2]), body]);
    };
    const u16Array = (values: number[]) => {
      const b = Buffer.alloc(4 + values.length * 2);
      b.writeUInt32LE(values.length, 0);
      values.forEach((v, i) => b.writeUInt16LE(v, 4 + i * 2));
      return b;
    };
    const header = Buffer.alloc(8);
    header.writeUInt16LE(100, 0); // standardVersion
    header.writeUInt32LE(6, 2); // vendorExtensionId
    header.writeUInt16LE(100, 6); // vendorExtensionVersion

    const functionalMode = Buffer.alloc(2);

    const buf = Buffer.concat([
      header,
      ptpString('fujifilm'),
      functionalMode,
      u16Array([0x1001, 0x1016]),
      u16Array([]),
      u16Array([0x5007, 0x500d, 0xd001]),
      u16Array([]),
      u16Array([]),
      ptpString('FUJIFILM'),
      ptpString('X100VI'),
      ptpString('1.10'),
      ptpString('SN123'),
    ]);

    const info = parseDeviceInfo(buf);
    assert.equal(info.manufacturer, 'FUJIFILM');
    assert.equal(info.model, 'X100VI');
    assert.equal(info.deviceVersion, '1.10');
    assert.deepEqual(info.devicePropertiesSupported, [0x5007, 0x500d, 0xd001]);
    assert.deepEqual(info.operationsSupported, [0x1001, 0x1016]);
  });
});
