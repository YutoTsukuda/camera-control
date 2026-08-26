/**
 * Claude へ渡すプロンプトの組み立て。
 *
 * システムプロンプトは capabilities/labels のテーブルから決定論的に生成する。
 * こうしておくと (1) 仕様表を直せばプロンプトも自動で追従し、
 * (2) リクエスト間でバイト列が完全に一致するため prompt caching が効く。
 */
import {
  APERTURES,
  ISO_NATIVE,
  LEAF_SHUTTER_LIMITS,
  ND_FILTER_STOPS,
} from '../domain/capabilities.js';
import { FILM_SIMULATION_LABELS, FILM_SIMULATION_NOTES } from '../domain/labels.js';
import { describeEv } from '../domain/scenes.js';
import { formatShutter } from '../domain/exposure.js';
import type { FilmSimulation, SceneContext, ShootingIntent } from '../domain/types.js';

function filmSimulationCatalog(): string {
  return (Object.keys(FILM_SIMULATION_LABELS) as FilmSimulation[])
    .map((key) => `- ${key}（${FILM_SIMULATION_LABELS[key]}）: ${FILM_SIMULATION_NOTES[key]}`)
    .join('\n');
}

function leafShutterTable(): string {
  return LEAF_SHUTTER_LIMITS.map(
    (row) => `  - F${row.maxAperture} 以下の開放側: 最高 ${formatShutter(row.fastestSec)}`,
  ).join('\n');
}

/**
 * 安定したシステムプロンプト（キャッシュ対象）。
 * 揮発する情報（撮影意図・測光値・時刻）は絶対にここへ入れない。
 */
export const SYSTEM_PROMPT = `あなたは FUJIFILM X100VI を長年使い込んだ写真家兼テクニカルアドバイザーです。
撮影者がスマートフォンから送ってきたシーンの写真と撮影意図をもとに、
そのカメラに書き込む静止画撮影設定を提案します。

# カメラの機構的な事実（必ず守ること）

- レンズは 23mm F2 固定（35mm判換算 35mm 相当）。ズームはできない。焦点距離を変えたい場合はデジタルテレコン（50mm/70mm相当、JPEG専用）。
- 絞りは F2〜F16、1/3段刻み: ${APERTURES.join(', ')}
- **シャッターはレンズシャッター（リーフシャッター）で、開放側ほど最高速が下がる**:
${leafShutterTable()}
  これが X100VI で最も間違えやすい点。日中に F2 で撮りたい場合、メカニカルシャッターでは 1/1000 秒までしか切れないため、
  内蔵ND（${ND_FILTER_STOPS}段）を使うか電子シャッターへ切り替える必要がある。
- 電子シャッターは最高 1/180000 秒まで切れるが、動体で像が歪み（ローリングシャッター）、
  蛍光灯・LED下で横縞が出る。無音が必要なとき以外はメカニカルを優先する。
- 常用 ISO は ${ISO_NATIVE[0]}〜${ISO_NATIVE[ISO_NATIVE.length - 1]}。ISO125 がベース感度。
- ボディ内手ブレ補正（IBIS）を搭載。35mm相当なので、静物の手持ちなら実用上 1/8 秒程度まで狙える。
  ただし被写体が動いている場合、ブレを決めるのは手ブレではなく被写体ブレである。
- ダイナミックレンジ設定には最低感度の条件がある: DR200% は ISO250 以上、DR400% は ISO500 以上。
- リーフシャッターはフラッシュが全速同調する（日中シンクロに強い）。

# フィルムシミュレーション

${filmSimulationCatalog()}

# 判断の方針

1. まず写真から光を読む。光の向き（順光/逆光/サイド）、質（硬い/柔らかい）、色（昼光/タングステン/蛍光灯/ミックス）、輝度差の大きさ。
2. 露出は「方針」だけを決める。具体的な F値・シャッター速度・ISO の組み合わせは
   システム側の決定論的なソルバが計算するので、あなたは exposurePlan
   （希望F値、許容できる最も遅いSS、ISO上限、露出補正、シャッター方式、ND可否）を返す。
3. 絵作り（look）はあなたの主戦場。シーンと撮影意図に最も合うフィルムシミュレーションを選び、
   トーンとホワイトバランスで仕上げる。ただし過剰な味付けは避け、後から追い込める余地を残す。
4. 露出補正はカメラの測光の癖を先読みして決める。逆光の人物は +0.7〜+1.7EV、
   雪や白い壁が画面を占めるなら +1EV 前後、夜のネオンや黒を締めたいなら -0.7EV 前後。
5. 撮影意図に矛盾がある場合（例: 「速いスポーツを止めたい」かつ「ISOは上げたくない」）は、
   warnings に日本語でトレードオフを明記する。勝手に片方を無視しない。
6. 迷ったら保守的に。失敗写真を減らすほうが、攻めた設定より価値が高い。

# 出力

指定された JSON スキーマに厳密に従って返答してください。日本語のフィールドはすべて日本語で書きます。`;

export interface AdvisorInput {
  /** シーンの写真（data URL または生の base64）。無くても提案は可能。 */
  imageBase64?: string;
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  intent?: ShootingIntent;
  scene?: SceneContext;
  /** カメラから読めた実測情報（測光値・現在設定など）。 */
  cameraReadout?: Record<string, unknown>;
}

const SUBJECT_LABELS: Record<string, string> = {
  PERSON: '人物',
  LANDSCAPE: '風景',
  STREET: 'スナップ・街',
  FOOD: '料理',
  ANIMAL: '動物・ペット',
  ARCHITECTURE: '建築',
  NIGHT: '夜景',
  MACRO: '近接・寄り',
  SPORTS: 'スポーツ・動体',
  OTHER: 'その他',
};

const PRIORITY_LABELS: Record<string, string> = {
  BOKEH: '背景をぼかしたい',
  SHARPNESS: '全体をシャープに写したい',
  FREEZE_MOTION: '動きを止めたい',
  LOW_NOISE: 'ノイズを抑えたい',
  MOOD: '雰囲気・空気感を優先したい',
  BALANCED: 'バランス重視',
};

const MOTION_LABELS: Record<string, string> = {
  STILL: '静止している',
  SLOW: 'ゆっくり動く（歩く程度）',
  FAST: '速く動く（走る・スポーツ）',
};

/**
 * 揮発する情報だけを含むユーザーメッセージ本文を組み立てる。
 * システムプロンプトの後ろに置くことでキャッシュ前方一致を壊さない。
 */
export function buildContextText(input: AdvisorInput): string {
  const lines: string[] = [];
  const intent = input.intent ?? {};
  const scene = input.scene ?? {};

  lines.push('# 撮影意図');
  if (intent.note) lines.push(`- 撮影者のメモ: ${intent.note}`);
  if (intent.subject) lines.push(`- 被写体: ${SUBJECT_LABELS[intent.subject] ?? intent.subject}`);
  if (intent.priority) lines.push(`- 優先したいこと: ${PRIORITY_LABELS[intent.priority] ?? intent.priority}`);
  if (intent.motion) lines.push(`- 被写体の動き: ${MOTION_LABELS[intent.motion] ?? intent.motion}`);
  if (intent.support) lines.push(`- 保持方法: ${intent.support === 'TRIPOD' ? '三脚' : '手持ち'}`);
  if (intent.wantRaw !== undefined) lines.push(`- RAW記録: ${intent.wantRaw ? '必要' : '不要'}`);
  if (intent.monochrome) lines.push('- モノクロで撮りたい');
  if (lines.length === 1) lines.push('- 指定なし（一般的な撮影として判断してください）');

  lines.push('');
  lines.push('# シーン情報');
  if (scene.ev100 !== undefined) {
    lines.push(
      `- 測光値: ${describeEv(scene.ev100)} ← これは実測値です。sceneEv100 にはこの値をそのまま返してください。`,
    );
  } else {
    lines.push('- 測光値: 未取得（写真から推定してください）');
  }
  if (scene.backlit !== undefined) lines.push(`- 逆光: ${scene.backlit ? 'はい' : 'いいえ'}`);
  if (scene.lightSource) lines.push(`- 光源: ${scene.lightSource}`);

  if (input.cameraReadout && Object.keys(input.cameraReadout).length > 0) {
    lines.push('');
    lines.push('# カメラの現在状態');
    for (const [key, value] of Object.entries(input.cameraReadout)) {
      lines.push(`- ${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push('');
  lines.push(
    input.imageBase64
      ? '添付の写真はこれから撮ろうとしているシーンです。この写真の光を読み取って設定を決めてください。'
      : '写真は添付されていません。撮影意図とシーン情報だけで、外しにくい設定を提案してください。confidence は控えめに。',
  );

  return lines.join('\n');
}

/** data URL から base64 本体と MIME タイプを取り出す。 */
export function parseImagePayload(
  raw: string | undefined,
): { data: string; mediaType: AdvisorInput['imageMediaType'] } | undefined {
  if (!raw) return undefined;
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(raw.trim());
  if (match) {
    return {
      data: (match[2] as string).replace(/\s/g, ''),
      mediaType: match[1] as AdvisorInput['imageMediaType'],
    };
  }
  return { data: raw.replace(/\s/g, ''), mediaType: 'image/jpeg' };
}
