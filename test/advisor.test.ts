import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { adviseByRules, adviseSettings, composeProposal, type Advice } from '../src/ai/index.js';
import { AdvisorUnavailableError } from '../src/ai/advisor.js';
import { validateSettings } from '../src/domain/validate.js';
import { APERTURES, ISO_NATIVE } from '../src/domain/capabilities.js';
import type { ShootingIntent } from '../src/domain/types.js';

const SUBJECTS: NonNullable<ShootingIntent['subject']>[] = [
  'PERSON', 'LANDSCAPE', 'STREET', 'FOOD', 'ANIMAL', 'ARCHITECTURE', 'NIGHT', 'MACRO', 'SPORTS', 'OTHER',
];
const PRIORITIES: NonNullable<ShootingIntent['priority']>[] = [
  'BOKEH', 'SHARPNESS', 'FREEZE_MOTION', 'LOW_NOISE', 'MOOD', 'BALANCED',
];

describe('ルールベース提案器', () => {
  it('被写体と優先軸の全組み合わせで、カメラに書ける設定を返す', () => {
    for (const subject of SUBJECTS) {
      for (const priority of PRIORITIES) {
        for (const ev100 of [3, 8, 12, 15]) {
          const input = { intent: { subject, priority }, scene: { ev100 } };
          const proposal = composeProposal(adviseByRules(input), input, 'rules');
          const s = proposal.settings;

          assert.ok(APERTURES.includes(s.aperture as number), `${subject}/${priority}: F${s.aperture}`);
          assert.ok(
            s.iso === 'AUTO' || ISO_NATIVE.includes(s.iso as number),
            `${subject}/${priority}: ISO${s.iso}`,
          );
          // 提案は必ず検証済みなので、再検証で値が変わってはいけない
          const revalidated = validateSettings(s);
          assert.deepEqual(revalidated.settings, s);
          assert.equal(
            revalidated.corrections.filter((c) => c.severity !== 'note').length,
            0,
            `${subject}/${priority}/EV${ev100} で未解決の補正が残った: ` +
              revalidated.corrections.map((c) => c.reason).join(' / '),
          );
        }
      }
    }
  });

  it('ボケ優先なら開放側を選ぶ', () => {
    const input = { intent: { priority: 'BOKEH' as const }, scene: { ev100: 12 } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.ok((proposal.settings.aperture as number) <= 2.8);
  });

  it('モノクロ指定ならモノクロ系フィルムシミュレーションを選ぶ', () => {
    const input = { intent: { monochrome: true }, scene: { ev100: 12 } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.equal(proposal.settings.filmSimulation, 'ACROS');
    assert.equal(proposal.settings.color, undefined);
  });

  it('逆光では露出補正をプラスに振る', () => {
    const input = { scene: { ev100: 14, backlit: true } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.ok((proposal.settings.exposureCompensation as number) > 0);
  });

  it('RAW希望なら画質モードにRAWを含める', () => {
    const input = { intent: { wantRaw: true }, scene: { ev100: 12 } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.equal(proposal.settings.imageQuality, 'FINE_RAW');
  });
});

describe('提案の合成', () => {
  const baseAdvice: Advice = {
    ...adviseByRules({ scene: { ev100: 12 } }),
  };

  it('実測の測光値はAIの推定より優先される', () => {
    const advice: Advice = { ...baseAdvice, sceneEv100: 4 };
    const proposal = composeProposal(advice, { scene: { ev100: 15 } }, 'claude');
    // EV15 として解かれていれば、EV4 相当の高感度にはならない
    assert.ok((proposal.predictedExposure?.iso ?? 0) <= 400);
    assert.ok(Math.abs((proposal.resolvedEv100 ?? 0) - 15) < 1);
  });

  it('自動露出モードではISOオートの上限と低速限界を書き込む', () => {
    const advice: Advice = { ...baseAdvice, exposureMode: 'A' };
    const proposal = composeProposal(advice, {}, 'claude');
    assert.equal(proposal.settings.iso, 'AUTO');
    assert.equal(proposal.settings.isoAutoMax, advice.exposurePlan.maxIso);
    assert.ok(proposal.settings.isoAutoMinShutterSec !== undefined);
  });

  it('マニュアルではISOを具体値で書き込む', () => {
    const advice: Advice = { ...baseAdvice, exposureMode: 'M' };
    const proposal = composeProposal(advice, { scene: { ev100: 12 } }, 'claude');
    assert.notEqual(proposal.settings.iso, 'AUTO');
    assert.equal(proposal.settings.isoAutoMax, undefined);
  });

  it('露出が合わない条件では確信度が下がる', () => {
    const advice: Advice = {
      ...baseAdvice,
      confidence: 1,
      exposurePlan: { ...baseAdvice.exposurePlan, maxIso: 125, allowStopDown: false, allowNd: false },
    };
    const dark = composeProposal(advice, { scene: { ev100: -5 } }, 'claude');
    assert.ok(dark.confidence < 1);
  });
});

describe('フォールバック', () => {
  it('Claudeが使えない場合はルールベースへ切り替え、理由を残す', async () => {
    const result = await adviseSettings(
      { scene: { ev100: 12 } },
      {
        advisor: {
          advise: async () => {
            throw new AdvisorUnavailableError('テスト用の障害');
          },
        },
      },
    );
    assert.equal(result.source, 'rules');
    assert.equal(result.fallbackReason, 'テスト用の障害');
    assert.ok(result.settings.aperture !== undefined);
  });

  it('offline 指定ならClaudeを呼ばない', async () => {
    let called = false;
    const result = await adviseSettings(
      { scene: { ev100: 12 } },
      {
        offline: true,
        advisor: {
          advise: async () => {
            called = true;
            throw new Error('呼ばれてはいけない');
          },
        },
      },
    );
    assert.equal(called, false);
    assert.equal(result.source, 'rules');
  });

  it('Claudeが成功すればその提案を使う', async () => {
    const advice = adviseByRules({ scene: { ev100: 12 } });
    const result = await adviseSettings(
      { scene: { ev100: 12 } },
      { advisor: { advise: async () => ({ ...advice, filmSimulation: undefined } as never) } },
    );
    assert.equal(result.source, 'claude');
    assert.equal(result.fallbackReason, undefined);
  });
});

describe('手ブレ限界の既定値', () => {
  it('人物は「ゆっくり動く」扱いにして低速限界を確保する', () => {
    const input = { intent: { subject: 'PERSON' as const }, scene: { ev100: 12 } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.ok(
      (proposal.settings.isoAutoMinShutterSec as number) <= 1 / 100,
      `人物で ${proposal.settings.isoAutoMinShutterSec} 秒は遅すぎる`,
    );
  });

  it('静物は低速側を許容して低感度を優先する', () => {
    const input = { intent: { subject: 'ARCHITECTURE' as const }, scene: { ev100: 8 } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.ok((proposal.settings.isoAutoMinShutterSec as number) > 1 / 100);
  });
});

describe('三脚の扱い', () => {
  it('三脚があるなら暗所でも被写体本来の絞りを保つ', () => {
    const handheld = { intent: { subject: 'NIGHT' as const, support: 'HANDHELD' as const }, scene: { ev100: 4 } };
    const tripod = { intent: { subject: 'NIGHT' as const, support: 'TRIPOD' as const }, scene: { ev100: 4 } };
    const a = composeProposal(adviseByRules(handheld), handheld, 'rules');
    const b = composeProposal(adviseByRules(tripod), tripod, 'rules');
    assert.ok((a.settings.aperture as number) <= 2.8, '手持ちの夜景は開放側へ');
    assert.ok((b.settings.aperture as number) >= 2, '三脚なら開放に張り付かない');
    assert.ok(
      (b.predictedExposure?.iso ?? 0) <= (a.predictedExposure?.iso ?? 0),
      '三脚なら長秒で稼いでISOを抑えられる',
    );
  });
});

describe('光と色の調整', () => {
  it('輝度差が大きいシーンではトーンを軟調に振る', () => {
    const input = { scene: { ev100: 14, backlit: true } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.ok((proposal.settings.highlightTone as number) < 0, 'ハイライトを粘らせるべき');
    assert.ok((proposal.settings.shadowTone as number) < 0, '暗部を持ち上げるべき');
  });

  it('平坦なシーンではトーンを触らない', () => {
    const input = { scene: { ev100: 12, contrast: 0.2, backlit: false } };
    const proposal = composeProposal(adviseByRules(input), input, 'rules');
    assert.equal(proposal.settings.highlightTone, 0);
    assert.equal(proposal.settings.shadowTone, 0);
  });

  it('日陰・曇天の青かぶりだけ控えめに戻す', () => {
    const shade = { scene: { ev100: 12, lightSource: 'SHADE' as const } };
    const unknown = { scene: { ev100: 12 } };
    assert.equal(composeProposal(adviseByRules(shade), shade, 'rules').settings.wbShiftRed, 1);
    assert.equal(
      composeProposal(adviseByRules(unknown), unknown, 'rules').settings.wbShiftRed,
      0,
      '光源が不明なときは振らない',
    );
  });
});
