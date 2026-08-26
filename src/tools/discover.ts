#!/usr/bin/env node
/**
 * 実機のプロパティ調査ツール。
 *
 *   npm run discover -- --host 192.168.0.1
 *
 * カメラに接続して GetDeviceInfo を読み、対応しているデバイスプロパティを一覧表示する。
 * 独自プロパティ（0xD000 以降）のコードはここでしか確認できないので、
 * 実機を使う前に必ず一度これを実行し、結果を config/fuji-properties.json に反映すること。
 */
import { parseDeviceInfo } from '../camera/ptpip/deviceInfo.js';
import { PtpIpClient } from '../camera/ptpip/client.js';
import { DEFAULT_BINDINGS } from '../camera/ptpip/fujiProps.js';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

const host = arg('host', '192.168.0.1');
const port = Number(arg('port', '55740'));

const client = new PtpIpClient({
  host,
  port,
  friendlyName: arg('name', 'X100VI-Discover'),
  logger: (message) => console.log(`  ${message}`),
});

console.log(`${host}:${port} へ接続します。カメラ側に確認画面が出たら許可してください。`);

try {
  await client.connect();
  const info = parseDeviceInfo(await client.getDeviceInfoRaw());

  console.log('\n=== カメラ情報 ===');
  console.log(`メーカー      : ${info.manufacturer}`);
  console.log(`モデル        : ${info.model}`);
  console.log(`ファームウェア: ${info.deviceVersion}`);
  console.log(`ベンダ拡張    : ${info.vendorExtensionDesc} (id=0x${info.vendorExtensionId.toString(16)})`);

  const known = new Map(DEFAULT_BINDINGS.map((b) => [b.code, b]));
  const standard = info.devicePropertiesSupported.filter((c) => c < 0xd000);
  const vendor = info.devicePropertiesSupported.filter((c) => c >= 0xd000);

  const dump = (codes: number[]) => {
    for (const code of codes) {
      const binding = known.get(code);
      const hex = `0x${code.toString(16).padStart(4, '0')}`;
      console.log(`  ${hex}${binding ? `  → ${binding.field} (${binding.confidence})` : '  → 未マッピング'}`);
    }
  };

  console.log(`\n=== PTP標準プロパティ (${standard.length}) ===`);
  dump(standard);
  console.log(`\n=== ベンダ独自プロパティ (${vendor.length}) ===`);
  dump(vendor);

  const unmapped = DEFAULT_BINDINGS.filter(
    (b) => !info.devicePropertiesSupported.includes(b.code),
  );
  if (unmapped.length > 0) {
    console.log('\n=== 警告: 既定表にあるがカメラが対応していないコード ===');
    for (const binding of unmapped) {
      console.log(`  ${binding.field}: 0x${binding.code.toString(16)} (${binding.confidence})`);
    }
    console.log('  config/fuji-properties.json で正しいコードに差し替えてください。');
  }
} catch (error) {
  console.error(`\n失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close();
}
