/**
 * ルールベースの提案器（オフライン/フォールバック用）。
 *
 * 撮影は電波の届かない場所でも行われるし、API が落ちている日に
 * 「設定が決まらないので撮れません」では道具として失格なので、
 * Claude と同じ `Advice` を返す決定論的な実装を常に用意しておく。
 * 素性は素直だが、露出ソルバとバリデータを共有するため破綻はしない。
 */
import { handheldFloorSec } from '../domain/exposure.js';
import { DEFAULT_EV100 } from '../domain/scenes.js';
import type { SceneContext, ShootingIntent } from '../domain/types.js';
import type { Advice } from './schema.js';
import type { AdvisorInput } from './prompt.js';

type Subject = NonNullable<ShootingIntent['subject']>;
type Priority = NonNullable<ShootingIntent['priority']>;

const APERTURE_BY_SUBJECT: Record<Subject, number> = {
  PERSON: 2.8,
  LANDSCAPE: 8,
  STREET: 5.6,
  FOOD: 2.8,
  ANIMAL: 2.8,
  ARCHITECTURE: 8,
  NIGHT: 2,
  MACRO: 4,
  SPORTS: 2.8,
  OTHER: 4,
};

const APERTURE_BY_PRIORITY: Partial<Record<Priority, number>> = {
  BOKEH: 2,
  SHARPNESS: 8,
};

const FILM_BY_SUBJECT: Record<Subject, Advice['look']['filmSimulation']> = {
  PERSON: 'ASTIA_SOFT',
  LANDSCAPE: 'VELVIA_VIVID',
  STREET: 'CLASSIC_CHROME',
  FOOD: 'PROVIA_STD',
  ANIMAL: 'PROVIA_STD',
  ARCHITECTURE: 'CLASSIC_CHROME',
  NIGHT: 'CLASSIC_NEG',
  MACRO: 'PROVIA_STD',
  SPORTS: 'PROVIA_STD',
  OTHER: 'PROVIA_STD',
};

/**
 * 被写体から動きの既定値を決める。
 *
 * 「人物＝静物」と扱うと ISO オートの低速限界が 1/4 秒まで落ち、
 * 呼吸や微妙な揺れでブレた写真が量産される。実用上、人や動物は
 * 静止しているつもりでも「ゆっくり動く」として扱うのが安全。
 */
function defaultMotion(subject: Subject): NonNullable<ShootingIntent['motion']> {
  if (subject === 'SPORTS') return 'FAST';
  if (subject === 'PERSON' || subject === 'ANIMAL' || subject === 'STREET') return 'SLOW';
  return 'STILL';
}

/** 被写体から明るさの当たりを付ける（測光値が無いときの最後の手段）。 */
function estimateEv(intent: ShootingIntent, scene: SceneContext): number {
  if (scene.ev100 !== undefined) return scene.ev100;
  if (intent.subject === 'NIGHT') return 4;
  if (intent.subject === 'FOOD') return 7;
  if (intent.subject === 'LANDSCAPE' || intent.subject === 'ARCHITECTURE') return 14;
  if (intent.subject === 'SPORTS') return 13;
  return DEFAULT_EV100;
}

export function adviseByRules(input: AdvisorInput): Advice {
  const intent = input.intent ?? {};
  const scene = input.scene ?? {};
  const subject: Subject = intent.subject ?? 'OTHER';
  const priority: Priority = intent.priority ?? 'BALANCED';

  const ev100 = estimateEv(intent, scene);
  const backlit = scene.backlit ?? false;
  const contrast = scene.contrast ?? (backlit ? 0.8 : 0.4);
  const dark = ev100 <= 7;

  // 暗所では光を稼ぐために開放側へ寄せるが、三脚があるなら長秒で稼げるので
  // 被写体本来の絞り（夜景や建築なら絞り込み）を維持する。
  const onTripod = intent.support === 'TRIPOD';
  const preferredAperture =
    APERTURE_BY_PRIORITY[priority] ??
    (dark && !onTripod ? Math.min(2.8, APERTURE_BY_SUBJECT[subject]) : APERTURE_BY_SUBJECT[subject]);

  const slowestShutterSec = handheldFloorSec({
    support: intent.support ?? 'HANDHELD',
    motion: intent.motion ?? defaultMotion(subject),
  });

  const maxIso =
    priority === 'LOW_NOISE' ? 1600 : subject === 'NIGHT' || dark ? 12800 : 6400;

  let exposureCompensation = 0;
  if (backlit) exposureCompensation += 1;
  if (subject === 'NIGHT') exposureCompensation -= 0.7;

  const monochrome = intent.monochrome === true;
  const filmSimulation: Advice['look']['filmSimulation'] = monochrome
    ? 'ACROS'
    : priority === 'MOOD'
      ? 'CLASSIC_NEG'
      : FILM_BY_SUBJECT[subject];

  const highContrast = contrast >= 0.6 || backlit;

  const warnings: string[] = [
    'AIによる提案が利用できないため、ルールベースの標準設定を返しています。',
  ];
  if (priority === 'FREEZE_MOTION' && maxIso <= 1600) {
    warnings.push('動きを止める設定とノイズを抑える設定は両立しにくいため、暗所ではブレる可能性があります。');
  }
  if (!input.imageBase64 && scene.ev100 === undefined) {
    warnings.push('写真も測光値も無いため、明るさは被写体から推定した概算です。');
  }

  return {
    sceneAnalysis: `${subject === 'OTHER' ? '一般的な' : ''}撮影シーンとして、明るさ EV${ev100.toFixed(1)} を前提に設定しました。`,
    sceneEv100: ev100,
    backlit,
    contrast,
    exposureMode: priority === 'FREEZE_MOTION' ? 'S' : 'A',
    exposurePlan: {
      preferredAperture,
      slowestShutterSec,
      maxIso,
      exposureCompensation,
      preferredShutterType: 'MS',
      allowNd: preferredAperture <= 2.8,
      allowStopDown: priority !== 'BOKEH',
    },
    look: {
      filmSimulation,
      whiteBalance: 'AUTO',
      whiteBalanceKelvin: null,
      wbShiftRed: 0,
      wbShiftBlue: 0,
      dynamicRange: highContrast ? 'DR200' : 'DR100',
      highlightTone: highContrast ? -1 : 0,
      shadowTone: backlit ? -1 : 0,
      color: 0,
      sharpness: 0,
      noiseReduction: maxIso >= 6400 ? -2 : 0,
      clarity: subject === 'PERSON' ? -1 : subject === 'LANDSCAPE' ? 1 : 0,
      grainEffect: priority === 'MOOD' ? 'WEAK_SMALL' : 'OFF',
      colorChromeEffect: monochrome ? 'OFF' : 'WEAK',
      colorChromeFxBlue: monochrome ? 'OFF' : 'OFF',
    },
    operation: {
      meteringMode: backlit && subject === 'PERSON' ? 'SPOT' : 'MULTI',
      focusMode: (intent.motion ?? defaultMotion(subject)) === 'STILL' ? 'AF_S' : 'AF_C',
      afArea:
        intent.motion === 'FAST' || subject === 'SPORTS'
          ? 'WIDE_TRACKING'
          : 'SINGLE_POINT',
      subjectDetection:
        subject === 'PERSON' ? 'FACE_EYE' : subject === 'ANIMAL' ? 'ANIMAL' : 'OFF',
      driveMode: intent.motion === 'FAST' || subject === 'SPORTS' ? 'CONTINUOUS_HIGH' : 'SINGLE',
      imageQuality: intent.wantRaw ? 'FINE_RAW' : 'FINE',
      digitalTeleconverter: 'OFF',
    },
    rationale:
      `${subject === 'OTHER' ? '汎用' : subject}向けの標準的な組み立てとして、` +
      `F${preferredAperture} を軸に、ブレ限界を確保しながら ISO を最小限に抑える方針で算出しました。` +
      (backlit ? '逆光のため露出補正をプラスに振っています。' : ''),
    warnings,
    confidence: 0.5,
  };
}
