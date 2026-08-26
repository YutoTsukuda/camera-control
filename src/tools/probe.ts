#!/usr/bin/env node
/**
 * 実機調査ツール（USB / gphoto2）。
 *
 *   npm run probe
 *
 * 実機に繋いだ状態で 1 回実行すると、
 *   1. カメラが検出できるか
 *   2. カメラが申告する設定ツリーの全項目
 *   3. 本システムのどのフィールドが解決できたか／できなかったか
 *   4. enum の照合結果（どのドメイン値がどの選択肢に当たったか）
 * を表示し、解決済みマッピングを config/gphoto2-mapping.json に保存する。
 *
 * このシステムは「実機が申告した情報だけ」で動くので、
 * 実機での運用は必ずここから始める。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Gphoto2Cli, explainGphoto2Error } from '../camera/gphoto2/cli.js';
import { parseAutoDetect, parseConfigList } from '../camera/gphoto2/parse.js';
import { resolveMapping } from '../camera/gphoto2/mapping.js';
import { FIELD_LABELS } from '../domain/labels.js';
import { loadConfig } from '../config.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = loadConfig();
const port = arg('port') ?? config.camera.gphoto2.port;
const cli = new Gphoto2Cli({
  binary: arg('binary') ?? config.camera.gphoto2.binary,
  ...(port ? { port } : {}),
  timeoutMs: 60_000,
});

const line = (char = '─') => console.log(char.repeat(64));

console.log('X100VI 実機調査（USB / gphoto2）');
line();

// --- 1. 検出 ---------------------------------------------------------------
const detect = await cli.run(['--auto-detect']);
if (detect.code !== 0) {
  console.error(`\n検出に失敗しました:\n  ${explainGphoto2Error(detect)}\n`);
  process.exit(1);
}

const cameras = parseAutoDetect(detect.stdout);
if (cameras.length === 0) {
  console.error(
    '\nカメラが見つかりませんでした。次を確認してください:\n' +
      '  1. USB ケーブルが接続され、カメラの電源が入っているか\n' +
      '  2. カメラ側「接続設定 → USB接続モード」が USB テザー撮影（またはUSB自動）か\n' +
      '  3. Linux の場合、gvfs がカメラを掴んでいないか\n' +
      '     systemctl --user stop gvfs-gphoto2-volume-monitor\n',
  );
  process.exit(1);
}

for (const camera of cameras) {
  console.log(`検出: ${camera.model}  (${camera.port})`);
}
if (cameras.length > 1) {
  console.log('\n複数台が検出されました。GPHOTO2_PORT で 1 台に固定してください。');
}

// --- 2. 設定ツリーの取得 ---------------------------------------------------
console.log('\n設定ツリーを読み込んでいます（数秒かかります）…');
const listed = await cli.run(['--list-all-config']);
if (listed.code !== 0) {
  console.error(`\n設定ツリーの取得に失敗しました:\n  ${explainGphoto2Error(listed)}\n`);
  process.exit(1);
}

const entries = parseConfigList(listed.stdout);
console.log(`${entries.length} 項目を取得しました。`);

// --- 3. マッピングの解決 ---------------------------------------------------
const report = resolveMapping(entries);

line();
console.log(`解決できたフィールド (${report.resolved.length})`);
line();
for (const resolved of report.resolved) {
  const label = FIELD_LABELS[resolved.field] ?? resolved.field;
  console.log(`\n■ ${label}  →  ${resolved.path}  [${resolved.type}]`);

  if (resolved.kind === 'enum' && resolved.valueMap) {
    const byIndex = new Map(resolved.choices.map((choice) => [choice.index, choice.value]));
    for (const [domainValue, index] of Object.entries(resolved.valueMap)) {
      console.log(`    ${domainValue.padEnd(24)} → 「${byIndex.get(index) ?? index}」`);
    }
    if (resolved.unmatchedValues?.length) {
      console.log(`    照合できず: ${resolved.unmatchedValues.join(', ')}`);
    }
  } else {
    const preview = resolved.choices.slice(0, 8).map((choice) => choice.value);
    console.log(
      `    選択肢 ${resolved.choices.length} 件: ${preview.join(', ')}` +
        (resolved.choices.length > preview.length ? ' …' : ''),
    );
    const unparsed = resolved.choices.filter((choice) => choice.parsed === undefined);
    if (unparsed.length > 0) {
      console.log(`    数値として解釈できなかった選択肢: ${unparsed.map((c) => c.value).join(', ')}`);
    }
  }
}

if (report.unresolved.length > 0) {
  line();
  console.log(`解決できなかったフィールド (${report.unresolved.length})`);
  line();
  for (const item of report.unresolved) {
    console.log(`  ${(FIELD_LABELS[item.field] ?? item.field).padEnd(20)} ${item.reason}`);
  }
  console.log(
    '\nこれらは適用時に「非対応」として報告され、送信されません。' +
      '\n該当する設定がカメラ側に別名で存在する場合は、下の全項目一覧から名前を探し、' +
      '\nsrc/camera/gphoto2/mapping.ts の candidates に追加してください。',
  );
}

// --- 4. 保存 ---------------------------------------------------------------
const mappingPath = arg('out') ?? config.camera.gphoto2.mappingPath;
await mkdir(path.dirname(mappingPath), { recursive: true });
await writeFile(
  mappingPath,
  `${JSON.stringify(
    { savedAt: new Date().toISOString(), model: cameras[0]?.model ?? 'unknown', resolved: report.resolved },
    null,
    2,
  )}\n`,
  'utf8',
);

const rawPath = `${mappingPath.replace(/\.json$/, '')}-raw.txt`;
await writeFile(rawPath, listed.stdout, 'utf8');

line();
console.log(`マッピングを保存しました : ${mappingPath}`);
console.log(`設定ツリーの生出力       : ${rawPath}`);
console.log(
  '\n次の手順:\n' +
    '  1. 上の照合結果に誤りがないか確認する（特にフィルムシミュレーション）\n' +
    `  2. 誤りがあれば ${path.basename(mappingPath)} の valueMap を直す（コード変更は不要）\n` +
    '  3. CAMERA_TRANSPORT=gphoto2 でサーバを起動する\n',
);
