/**
 * PTP DeviceInfo データセットのパーサ。
 *
 * 実機がどのプロパティに対応しているかは、ここを読むのが唯一確実な方法。
 * `npm run discover` はこの結果をもとに config/fuji-properties.json の雛形を作る。
 */

export interface PtpDeviceInfo {
  standardVersion: number;
  vendorExtensionId: number;
  vendorExtensionVersion: number;
  vendorExtensionDesc: string;
  functionalMode: number;
  operationsSupported: number[];
  eventsSupported: number[];
  devicePropertiesSupported: number[];
  captureFormats: number[];
  imageFormats: number[];
  manufacturer: string;
  model: string;
  deviceVersion: string;
  serialNumber: string;
}

class Cursor {
  offset = 0;
  constructor(private readonly buf: Buffer) {}

  uint16(): number {
    const value = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  uint32(): number {
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  /** PTP 配列: 要素数(uint32) + 要素列。 */
  uint16Array(): number[] {
    const count = this.uint32();
    const values: number[] = [];
    for (let i = 0; i < count; i += 1) values.push(this.uint16());
    return values;
  }

  /** PTP 文字列: 文字数(uint8、NUL含む) + UTF-16LE。 */
  string(): string {
    const chars = this.buf.readUInt8(this.offset);
    this.offset += 1;
    if (chars === 0) return '';
    const bytes = chars * 2;
    const value = this.buf.subarray(this.offset, this.offset + bytes - 2).toString('utf16le');
    this.offset += bytes;
    return value;
  }
}

export function parseDeviceInfo(buf: Buffer): PtpDeviceInfo {
  const c = new Cursor(buf);
  return {
    standardVersion: c.uint16(),
    vendorExtensionId: c.uint32(),
    vendorExtensionVersion: c.uint16(),
    vendorExtensionDesc: c.string(),
    functionalMode: c.uint16(),
    operationsSupported: c.uint16Array(),
    eventsSupported: c.uint16Array(),
    devicePropertiesSupported: c.uint16Array(),
    captureFormats: c.uint16Array(),
    imageFormats: c.uint16Array(),
    manufacturer: c.string(),
    model: c.string(),
    deviceVersion: c.string(),
    serialNumber: c.string(),
  };
}
