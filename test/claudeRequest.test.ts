/**
 * Claude へ投げるリクエストの形を、ネットワーク無しで検証する。
 * 実際の API 呼び出しは行わず、SDK クライアントを差し替えてパラメータを覗く。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ClaudeAdvisor, AdvisorUnavailableError } from '../src/ai/advisor.js';
import { AdviceSchema } from '../src/ai/schema.js';
import { adviseByRules } from '../src/ai/rules.js';
import { SYSTEM_PROMPT, buildContextText, parseImagePayload } from '../src/ai/prompt.js';

/** 1x1 の透明PNG。 */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function fakeClient(
  capture: { params?: Record<string, unknown> },
  response: Partial<{ parsed_output: unknown; stop_reason: string }> = {},
): Anthropic {
  return {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        capture.params = params;
        return {
          stop_reason: response.stop_reason ?? 'end_turn',
          parsed_output: 'parsed_output' in response ? response.parsed_output : adviseByRules({}),
          content: [],
        };
      },
    },
  } as unknown as Anthropic;
}

describe('Claude リクエストの組み立て', () => {
  it('構造化出力スキーマが JSON Schema に変換できる', () => {
    const format = zodOutputFormat(AdviceSchema);
    assert.equal(format.type, 'json_schema');
    const schema = format.schema as { properties: Record<string, unknown> };
    assert.ok(schema.properties.exposurePlan);
    assert.ok(schema.properties.look);
    assert.ok(schema.properties.sceneEv100);
  });

  it('モデル・出力形式・キャッシュ指定が意図通り', async () => {
    const capture: { params?: Record<string, unknown> } = {};
    const advisor = new ClaudeAdvisor({ client: fakeClient(capture), model: 'claude-opus-5' });
    await advisor.advise({ intent: { subject: 'PERSON' }, scene: { ev100: 12 } });

    const params = capture.params!;
    assert.equal(params.model, 'claude-opus-5');

    const system = params.system as { text: string; cache_control?: unknown }[];
    assert.equal(system[0]?.text, SYSTEM_PROMPT);
    assert.deepEqual(system[0]?.cache_control, { type: 'ephemeral' });

    const outputConfig = params.output_config as { effort: string; format: { type: string } };
    assert.equal(outputConfig.effort, 'medium');
    assert.equal(outputConfig.format.type, 'json_schema');
  });

  it('写真は image ブロックとして本文の先頭に置く', async () => {
    const capture: { params?: Record<string, unknown> } = {};
    const advisor = new ClaudeAdvisor({ client: fakeClient(capture) });
    await advisor.advise({ imageBase64: `data:image/png;base64,${TINY_PNG}` });

    const messages = capture.params!.messages as { role: string; content: { type: string; source?: { media_type: string; data: string } }[] }[];
    const content = messages[0]!.content;
    assert.equal(content[0]?.type, 'image');
    assert.equal(content[0]?.source?.media_type, 'image/png');
    assert.equal(content[0]?.source?.data, TINY_PNG);
    assert.equal(content[1]?.type, 'text');
  });

  it('写真が無ければ本文だけを送る', async () => {
    const capture: { params?: Record<string, unknown> } = {};
    await new ClaudeAdvisor({ client: fakeClient(capture) }).advise({});
    const messages = capture.params!.messages as { content: { type: string }[] }[];
    assert.equal(messages[0]!.content.length, 1);
    assert.equal(messages[0]!.content[0]?.type, 'text');
  });

  it('拒否応答はフォールバック可能なエラーにする', async () => {
    const advisor = new ClaudeAdvisor({
      client: fakeClient({}, { stop_reason: 'refusal', parsed_output: null }),
    });
    await assert.rejects(() => advisor.advise({}), AdvisorUnavailableError);
  });

  it('構造化出力の解析失敗もフォールバック可能なエラーにする', async () => {
    const advisor = new ClaudeAdvisor({ client: fakeClient({}, { parsed_output: null }) });
    await assert.rejects(() => advisor.advise({}), AdvisorUnavailableError);
  });
});

describe('プロンプト本文', () => {
  it('システムプロンプトはリーフシャッターの制約を必ず含む', () => {
    assert.match(SYSTEM_PROMPT, /1\/1000/);
    assert.match(SYSTEM_PROMPT, /リーフシャッター/);
    assert.match(SYSTEM_PROMPT, /内蔵ND/);
  });

  it('システムプロンプトは呼び出しごとに変化しない（キャッシュ前方一致を守る）', () => {
    assert.equal(SYSTEM_PROMPT, SYSTEM_PROMPT.slice(0));
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(SYSTEM_PROMPT), 'タイムスタンプを含めてはいけない');
  });

  it('実測の測光値はそのまま使うよう明示する', () => {
    const text = buildContextText({ scene: { ev100: 9 } });
    assert.match(text, /EV 9\.0/);
    assert.match(text, /実測値/);
  });

  it('写真が無い場合は確信度を下げるよう指示する', () => {
    assert.match(buildContextText({}), /confidence は控えめに/);
  });

  it('data URL からメディアタイプを取り出せる', () => {
    assert.deepEqual(parseImagePayload(`data:image/jpeg;base64,${TINY_PNG}`), {
      data: TINY_PNG,
      mediaType: 'image/jpeg',
    });
    assert.equal(parseImagePayload(TINY_PNG)?.mediaType, 'image/jpeg');
    assert.equal(parseImagePayload(undefined), undefined);
  });
});

describe('構造化出力の耐性', () => {
  it('語彙外の列挙値が来ても提案全体を捨てず、安全な既定値へ落とす', () => {
    const format = zodOutputFormat(AdviceSchema);
    const base = adviseByRules({ scene: { ev100: 12 } });
    const raw = JSON.stringify({
      ...base,
      look: { ...base.look, filmSimulation: 'VELVIA_2000', dynamicRange: 'DR800' },
      operation: { ...base.operation, focusMode: 'AF-C' },
      confidence: 1.7,
    });
    const parsed = format.parse(raw);
    assert.equal(parsed.look.filmSimulation, 'PROVIA_STD');
    assert.equal(parsed.look.dynamicRange, 'DR_AUTO');
    assert.equal(parsed.operation.focusMode, 'AF_S');
    assert.equal(parsed.confidence, 0.5);
    // 巻き添えで壊れていないこと
    assert.equal(parsed.exposurePlan.preferredAperture, base.exposurePlan.preferredAperture);
  });

  it('スキーマの説明文に選択肢がそのまま載る（APIのスキーマ・サブセット対策）', () => {
    const schema = zodOutputFormat(AdviceSchema).schema as {
      $defs: Record<string, { description?: string }>;
    };
    const descriptions = Object.values(schema.$defs ?? {}).map((d) => d.description ?? '');
    assert.ok(
      descriptions.some((d) => d.includes('CLASSIC_NEG')),
      'フィルムシミュレーションの選択肢が説明文に含まれるべき',
    );
  });
});

describe('光と色のプロンプト', () => {
  it('トーンカーブの向き（マイナスが軟調）を明示している', () => {
    assert.match(SYSTEM_PROMPT, /ハイライトトーン/);
    assert.match(SYSTEM_PROMPT, /マイナスが軟調/);
    assert.match(SYSTEM_PROMPT, /シャドウトーン マイナス/);
  });

  it('WBシフトの2軸の向きを明示している', () => {
    assert.match(SYSTEM_PROMPT, /wbShiftRed: プラスで赤方向/);
    assert.match(SYSTEM_PROMPT, /wbShiftBlue: プラスで青方向/);
    assert.match(SYSTEM_PROMPT, /マゼンタ方向/);
  });

  it('R/G/Bを独立に動かせないことを伝えている（存在しない操作を提案させない）', () => {
    assert.match(SYSTEM_PROMPT, /R\/G\/B を独立に上げ下げする機構は無い/);
  });

  it('トーンカーブとダイナミックレンジ設定を混同させない', () => {
    assert.match(SYSTEM_PROMPT, /トーンカーブは階調の性格を、DR は救える範囲を変える/);
  });
});
