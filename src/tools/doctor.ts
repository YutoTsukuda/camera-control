#!/usr/bin/env node
/**
 * 実機健診ツール。
 *
 *   npm run doctor              読み取り確認 ＋ 非破壊の一括書き込み確認
 *   npm run doctor -- --roundtrip   値を変えて読み戻す確認（実行後に元へ戻す）
 *   npm run doctor -- --read-only   カメラへ一切書き込まない
 *   npm run doctor -- --ai          Claude API への疎通も確認する
 *
 * このシステムには「実機でしか確かめられない前提」がいくつかある。
 * それらを 1 コマンドで潰し、失敗したものには対処法を添えて出す。
 * probe が「何が読めるか」を調べるのに対し、doctor は「設計の前提が成り立つか」を調べる。
 */
import { Gphoto2Cli, explainGphoto2Error, type Gphoto2Runner } from '../camera/gphoto2/cli.js';
import { parseAutoDetect, parseConfigList } from '../camera/gphoto2/parse.js';
import { encodeSet, resolveMapping, type ResolvedField } from '../camera/gphoto2/mapping.js';
import { FIELD_LABELS } from '../domain/labels.js';
import { adviseSettings } from '../ai/index.js';
import { loadConfig } from '../config.js';

type Status = 'ok' | 'ng' | 'warn' | 'skip';

interface Check {
  id: string;
  name: string;
  status: Status;
  detail?: string;
  /** 失敗したときに何をすればよいか。 */
  hint?: string;
}

const checks: Check[] = [];
const record = (check: Check): Check => {
  checks.push(check);
  const mark = { ok: ' OK ', ng: ' NG ', warn: 'WARN', skip: 'SKIP' }[check.status];
  console.log(`[${mark}] ${check.id}. ${check.name}`);
  if (check.detail) console.log(`        ${check.detail.replace(/\n/g, '\n        ')}`);
  if (check.hint && check.status !== 'ok') console.log(`        → ${check.hint}`);
  return check;
};

const has = (flag: string) => process.argv.includes(`--${flag}`);
const readOnly = has('read-only');
const roundtrip = has('roundtrip');

const config = loadConfig();
const cli: Gphoto2Runner = new Gphoto2Cli({
  binary: config.camera.gphoto2.binary,
  ...(config.camera.gphoto2.port ? { port: config.camera.gphoto2.port } : {}),
  timeoutMs: 60_000,
});

console.log('X100VI 実機健診');
console.log('='.repeat(64));
console.log(
  readOnly
    ? 'モード: 読み取りのみ（カメラへは一切書き込みません）\n'
    : roundtrip
      ? 'モード: 読み取り ＋ 書き込み往復確認（変更した値は元に戻します）\n'
      : 'モード: 読み取り ＋ 非破壊の書き込み確認（現在値と同じ値を書き戻すだけです）\n',
);

// --- 1. gphoto2 が使えるか -------------------------------------------------
const version = await cli.run(['--version']);
if (version.code !== 0) {
  record({
    id: '1',
    name: 'gphoto2 が使えるか',
    status: 'ng',
    detail: explainGphoto2Error(version),
    hint: 'Linux: sudo apt install gphoto2 / macOS: brew install gphoto2',
  });
  summarize();
  process.exit(1);
}
record({
  id: '1',
  name: 'gphoto2 が使えるか',
  status: 'ok',
  detail: version.stdout.split('\n')[0] ?? '',
});

// --- 2. カメラを検出できるか -----------------------------------------------
const detect = await cli.run(['--auto-detect']);
const cameras = detect.code === 0 ? parseAutoDetect(detect.stdout) : [];
if (cameras.length === 0) {
  record({
    id: '2',
    name: 'カメラを検出できるか',
    status: 'ng',
    detail: detect.code === 0 ? '検出結果が空でした。' : explainGphoto2Error(detect),
    hint:
      'USBケーブルの接続とカメラの電源、カメラ側「接続設定 → USB接続モード」が' +
      ' USBテザー撮影になっているかを確認してください。',
  });
  summarize();
  process.exit(1);
}
record({
  id: '2',
  name: 'カメラを検出できるか',
  status: 'ok',
  detail: cameras.map((c) => `${c.model} (${c.port})`).join(' / '),
});
if (cameras.length > 1) {
  record({
    id: '2b',
    name: 'カメラが1台に定まっているか',
    status: 'warn',
    detail: `${cameras.length} 台検出されました。`,
    hint: 'GPHOTO2_PORT で対象を固定してください。',
  });
}

// --- 3. 他プロセスと競合していないか ---------------------------------------
const summary = await cli.run(['--summary']);
record(
  summary.code === 0
    ? { id: '3', name: 'カメラを占有できるか（gvfs等との競合）', status: 'ok' }
    : {
        id: '3',
        name: 'カメラを占有できるか（gvfs等との競合）',
        status: 'ng',
        detail: explainGphoto2Error(summary),
        hint: 'systemctl --user stop gvfs-gphoto2-volume-monitor  を実行してから再試行してください。',
      },
);

// --- 4. 設定ツリーを取得できるか -------------------------------------------
const listed = await cli.run(['--list-all-config']);
if (listed.code !== 0) {
  record({
    id: '4',
    name: '設定ツリーを取得できるか',
    status: 'ng',
    detail: explainGphoto2Error(listed),
    hint: 'カメラの電源を入れ直し、テザー撮影モードに入っているか確認してください。',
  });
  summarize();
  process.exit(1);
}
const entries = parseConfigList(listed.stdout);
record({
  id: '4',
  name: '設定ツリーを取得できるか',
  status: entries.length >= 20 ? 'ok' : 'warn',
  detail: `${entries.length} 項目`,
  hint:
    entries.length < 20
      ? '項目が少なすぎます。カメラがテザー撮影モードに入りきっていない可能性があります。'
      : undefined,
});

// --- 5. 出力書式（版差）が想定通りか ---------------------------------------
const usesEnd = /^END$/m.test(listed.stdout);
record({
  id: '5',
  name: '出力書式をパーサが正しく解釈できているか',
  status: entries.length > 0 && entries.every((e) => e.path.startsWith('/')) ? 'ok' : 'ng',
  detail: `項目の区切り: ${usesEnd ? 'END あり' : 'END なし（次のパス行で区切る）'}`,
  hint: 'パスが壊れている場合、gphoto2 の版が想定外です。--version の出力を添えて報告してください。',
});

// --- 6/7. 必要なフィールドが公開されているか -------------------------------
const report = resolveMapping(entries);
const resolvedByField = new Map(report.resolved.map((r) => [r.field, r]));
const label = (field: string) => FIELD_LABELS[field] ?? field;

const groups: { id: string; name: string; fields: string[]; critical: boolean }[] = [
  {
    id: '6',
    name: '露出系が公開されているか（これが無いと成立しない）',
    fields: ['aperture', 'shutterSpeedSec', 'iso', 'exposureCompensation'],
    critical: true,
  },
  {
    id: '7',
    name: '絵作り系が公開されているか',
    fields: ['filmSimulation', 'whiteBalance', 'dynamicRange'],
    critical: false,
  },
  {
    id: '8',
    name: '光の調整・色のバランスが公開されているか',
    fields: ['highlightTone', 'shadowTone', 'wbShiftRed', 'wbShiftBlue', 'whiteBalanceKelvin'],
    critical: false,
  },
];

for (const group of groups) {
  const found = group.fields.filter((field) => resolvedByField.has(field as never));
  const missing = group.fields.filter((field) => !resolvedByField.has(field as never));
  record({
    id: group.id,
    name: group.name,
    status: missing.length === 0 ? 'ok' : group.critical ? 'ng' : 'warn',
    detail:
      `対応 ${found.length}/${group.fields.length}` +
      (missing.length > 0 ? `  未対応: ${missing.map(label).join(', ')}` : ''),
    hint:
      missing.length > 0
        ? 'config/gphoto2-mapping-raw.txt を該当する語で検索し、見つかった名前を' +
          ' src/camera/gphoto2/mapping.ts の candidates に追加してください。'
        : undefined,
  });
}

// --- 9. 選択肢の表記をこちらが解釈できているか -----------------------------
const numericKinds = new Set(['aperture', 'shutter', 'iso', 'expcomp', 'number']);
const unparsed = report.resolved
  .filter((r) => numericKinds.has(r.kind) && r.choices.length > 0)
  .map((r) => ({
    field: r.field,
    bad: r.choices.filter((c) => c.parsed === undefined).map((c) => c.value),
  }))
  .filter((row) => row.bad.length > 0);

record({
  id: '9',
  name: '選択肢の表記を数値として解釈できているか',
  status: unparsed.length === 0 ? 'ok' : 'warn',
  detail:
    unparsed.length === 0
      ? '数値系のすべての選択肢を解釈できました。'
      : unparsed
          .map((row) => `${label(row.field)}: ${row.bad.slice(0, 6).join(', ')}`)
          .join('\n'),
  hint:
    unparsed.length > 0
      ? 'Bulb や Auto のような数値でない選択肢なら無視して構いません。' +
        ' 数値のはずなのに解釈できていない表記があれば報告してください。'
      : undefined,
});

// --- 10. 列挙の照合に取りこぼしが無いか ------------------------------------
const unmatched = report.resolved
  .filter((r) => r.unmatchedValues?.length)
  .map((r) => `${label(r.field)}: ${r.unmatchedValues?.join(', ')}`);
record({
  id: '10',
  name: '列挙値をすべて照合できているか',
  status: unmatched.length === 0 ? 'ok' : 'warn',
  detail: unmatched.length === 0 ? '取りこぼしなし。' : unmatched.join('\n'),
  hint:
    unmatched.length > 0
      ? 'カメラにその選択肢が存在しないだけなら問題ありません。' +
        ' 存在するのに照合できていない場合は config/gphoto2-mapping.json の valueMap を直してください。'
      : undefined,
});

// --- 11. 複数項目の一括読み出しが通るか（状態取得の前提）-------------------
const readTargets = ['aperture', 'shutterSpeedSec', 'iso']
  .map((field) => resolvedByField.get(field as never))
  .filter((r): r is ResolvedField => r !== undefined);

if (readTargets.length >= 2) {
  const multiGet = await cli.run(readTargets.flatMap((r) => ['--get-config', r.path]));
  const got = multiGet.code === 0 ? parseConfigList(multiGet.stdout) : [];
  record({
    id: '11',
    name: '複数項目を1プロセスでまとめて読めるか',
    status: multiGet.code === 0 && got.length >= readTargets.length ? 'ok' : 'ng',
    detail:
      multiGet.code === 0
        ? `${readTargets.length} 項目を要求し ${got.length} 項目を取得`
        : explainGphoto2Error(multiGet),
    hint: '通らない場合、状態取得を1項目ずつに分ける必要があります。この結果を報告してください。',
  });
} else {
  record({ id: '11', name: '複数項目を1プロセスでまとめて読めるか', status: 'skip' });
}

// --- 12. 複数項目の一括書き込みが通るか（一括適用の前提）-------------------
// 現在値と同じ値を書き戻すだけなので、カメラの設定は変わらない。
if (readOnly) {
  record({
    id: '12',
    name: '複数項目を1プロセスでまとめて書けるか',
    status: 'skip',
    detail: '--read-only が指定されています。',
  });
} else if (readTargets.length >= 2) {
  const args: string[] = [];
  const written: string[] = [];
  for (const target of readTargets) {
    const currentChoice = target.choices.find((c) => c.value === currentValueOf(target));
    if (!currentChoice) continue;
    args.push('--set-config-index', `${target.path}=${currentChoice.index}`);
    written.push(`${label(target.field)}=${currentChoice.value}`);
  }

  if (args.length === 0) {
    record({
      id: '12',
      name: '複数項目を1プロセスでまとめて書けるか',
      status: 'skip',
      detail: '現在値を選択肢に照合できなかったため実施しませんでした。',
    });
  } else {
    const batch = await cli.run(args);
    if (batch.code === 0) {
      record({
        id: '12',
        name: '複数項目を1プロセスでまとめて書けるか',
        status: 'ok',
        detail: `現在値と同じ値を書き戻し: ${written.join(', ')}`,
      });
    } else {
      // 実際のアダプタと同じく、個別再試行で原因を切り分ける。
      const failures: string[] = [];
      for (let i = 0; i < args.length; i += 2) {
        const single = await cli.run([args[i] as string, args[i + 1] as string]);
        if (single.code !== 0) {
          failures.push(`${written[i / 2]}: ${explainGphoto2Error(single)}`);
        }
      }
      record({
        id: '12',
        name: '複数項目を1プロセスでまとめて書けるか',
        status: failures.length > 0 ? 'warn' : 'ng',
        detail:
          failures.length > 0
            ? `個別実行でも失敗した項目があります。一括の可否は判定できません。\n${failures.join('\n')}`
            : `一括は失敗したが個別実行はすべて成功しました。一括書き込みに対応していません。`,
        hint:
          failures.length > 0
            ? '絞りリングを A、SSダイヤルを A、露出補正ダイヤルを C にしてから再実行してください。'
            : 'この結果を報告してください。アダプタを1項目ずつ書き込む方式に変更します。',
      });
    }
  }
} else {
  record({ id: '12', name: '複数項目を1プロセスでまとめて書けるか', status: 'skip' });
}

// --- 13. 書いた値が実際に反映されるか（往復確認）---------------------------
if (!roundtrip || readOnly) {
  record({
    id: '13',
    name: '書いた値が実際に反映されるか（往復確認）',
    status: 'skip',
    detail: '--roundtrip を付けると実施します（変更後に元の値へ戻します）。',
  });
} else {
  const target = resolvedByField.get('filmSimulation' as never) ?? readTargets[0];
  if (!target || target.choices.length < 2) {
    record({ id: '13', name: '書いた値が実際に反映されるか（往復確認）', status: 'skip' });
  } else {
    const before = currentValueOf(target);
    const beforeChoice = target.choices.find((c) => c.value === before);
    const other = target.choices.find((c) => c.value !== before);

    if (!beforeChoice || !other) {
      record({ id: '13', name: '書いた値が実際に反映されるか（往復確認）', status: 'skip' });
    } else {
      const set = await cli.run(['--set-config-index', `${target.path}=${other.index}`]);
      const after = set.code === 0 ? await readSingle(target.path) : undefined;
      // 何があっても元の値へ戻す
      await cli.run(['--set-config-index', `${target.path}=${beforeChoice.index}`]);
      const restored = await readSingle(target.path);

      record({
        id: '13',
        name: '書いた値が実際に反映されるか（往復確認）',
        status: set.code === 0 && after === other.value ? 'ok' : 'ng',
        detail:
          set.code !== 0
            ? explainGphoto2Error(set)
            : `${label(target.field)}: 「${before}」→「${other.value}」を書き込み、読み戻し結果は「${after}」（復元後:「${restored}」）`,
        hint:
          set.code === 0 && after !== other.value
            ? '書き込みは成功しているのに値が変わっていません。カメラの物理ダイヤルが優先されている可能性があります。'
            : '物理ダイヤルの位置を確認してください。',
      });
    }
  }
}

// --- 14. レリーズ ----------------------------------------------------------
record({
  id: '14',
  name: 'レリーズ（--trigger-capture）',
  status: 'skip',
  detail: '実際に1枚撮影されるため自動では試しません。手順書の手動確認を参照してください。',
});

// --- 15. Claude API への疎通 -----------------------------------------------
if (!has('ai')) {
  record({
    id: '15',
    name: 'Claude API への疎通',
    status: 'skip',
    detail: '--ai を付けると実施します（1回分の API 利用料がかかります）。',
  });
} else if (config.ai.offline) {
  record({
    id: '15',
    name: 'Claude API への疎通',
    status: 'ng',
    detail: 'ANTHROPIC_API_KEY が設定されていないため、ルールベースで動作します。',
    hint: 'export ANTHROPIC_API_KEY=sk-ant-... を設定してください。',
  });
} else {
  const started = Date.now();
  const proposal = await adviseSettings(
    { intent: { subject: 'STREET', priority: 'BALANCED' }, scene: { ev100: 12 } },
    { model: config.ai.model, effort: config.ai.effort, timeoutMs: config.ai.timeoutMs },
  );
  record({
    id: '15',
    name: 'Claude API への疎通',
    status: proposal.source === 'claude' ? 'ok' : 'ng',
    detail:
      proposal.source === 'claude'
        ? `${config.ai.model} から構造化出力を取得（${Date.now() - started}ms）`
        : `ルールベースへフォールバックしました: ${proposal.fallbackReason}`,
    hint: proposal.source !== 'claude' ? 'APIキー、ネットワーク、モデル名を確認してください。' : undefined,
  });
}

summarize();

// --- ヘルパ ---------------------------------------------------------------

/** 解決時に取得済みの現在値。--list-all-config の結果から引く。 */
function currentValueOf(resolved: ResolvedField): string {
  return entries.find((entry) => entry.path === resolved.path)?.current ?? '';
}

async function readSingle(path: string): Promise<string | undefined> {
  const result = await cli.run(['--get-config', path]);
  if (result.code !== 0) return undefined;
  return parseConfigList(result.stdout)[0]?.current;
}

function summarize(): void {
  const count = (status: Status) => checks.filter((c) => c.status === status).length;
  console.log(`\n${'='.repeat(64)}`);
  console.log(
    `結果: OK ${count('ok')} / NG ${count('ng')} / WARN ${count('warn')} / SKIP ${count('skip')}`,
  );

  const blockers = checks.filter((c) => c.status === 'ng');
  if (blockers.length > 0) {
    console.log('\n先に解決すべき項目:');
    for (const check of blockers) console.log(`  ${check.id}. ${check.name}`);
  } else if (count('warn') > 0) {
    console.log('\n動作はしますが、一部の設定はカメラへ送られません（WARN の項目）。');
  } else {
    console.log('\n自動で確認できる項目はすべて通りました。');
    console.log('残りは docs/verification.md の手動確認へ進んでください。');
  }
}
