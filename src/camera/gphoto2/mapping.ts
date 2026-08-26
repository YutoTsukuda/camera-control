/**
 * ドメイン設定 ↔ gphoto2 の設定ツリーの対応付け。
 *
 * ここが本システムの「推測をやめた」中核。プロパティ名も選択肢も
 * こちらで決め打ちせず、実機が `--list-all-config` で申告した内容から解決する。
 *
 *   1. フィールドごとに候補となる設定名を優先順で持つ（機種やドライバ版で名前が揺れるため）
 *   2. 実機に存在するものだけを採用する
 *   3. 値は、実機が返した選択肢の中から照合して選ぶ
 *   4. 解決できなかったフィールドは「送らない」。理由を添えて報告する
 *
 * 解決結果は `npm run probe` で JSON に保存でき、次回以降はそれを読む。
 * 誤って照合された項目は JSON を手で直せばコード変更なしで矯正できる。
 */
import {
  normalize,
  parseAperture,
  parseExposureCompensation,
  parseIso,
  parseShutterSeconds,
  parseSignedNumber,
  type ConfigEntry,
} from './parse.js';
import type { ShootingSettings } from '../../domain/types.js';

/** 値の性質。照合アルゴリズムを決める。 */
export type FieldKind =
  | 'aperture'
  | 'shutter'
  | 'iso'
  | 'expcomp'
  /** 単位を持たない符号つき数値。トーンカーブ・WBシフト・シャープネスなど。 */
  | 'number'
  | 'enum'
  | 'toggle';

interface FieldSpec {
  kind: FieldKind;
  /** 設定名の候補（優先順）。パス末尾と正規化して比較する。 */
  candidates: string[];
  /** enum の場合の、ドメイン値 → 実機の選択肢を探すためのキーワード。 */
  synonyms?: Record<string, string[]>;
}

/**
 * 対応フィールドの定義。
 *
 * 候補名は libgphoto2 の ptp2 ドライバが一般に使う widget 名に基づく。
 * 実機に無ければ単に採用されないだけで、害はない。
 */
export const FIELD_SPECS: Partial<Record<keyof ShootingSettings, FieldSpec>> = {
  aperture: { kind: 'aperture', candidates: ['f-number', 'fnumber', 'aperture'] },
  shutterSpeedSec: {
    kind: 'shutter',
    candidates: ['shutterspeed', 'shutterspeed2', 'exposuretime'],
  },
  iso: { kind: 'iso', candidates: ['iso', 'isospeed', 'isoauto'] },
  exposureCompensation: {
    kind: 'expcomp',
    candidates: ['exposurecompensation', 'exposurebiascompensation'],
  },
  exposureMode: {
    kind: 'enum',
    candidates: ['expprogram', 'exposureprogram', 'autoexposuremode', 'capturemode'],
    synonyms: {
      P: ['p', 'program', 'programauto', 'programae'],
      A: ['a', 'aperturepriority', 'av', 'aperture'],
      S: ['s', 'shutterpriority', 'tv', 'shutter'],
      M: ['m', 'manual'],
    },
  },
  whiteBalance: {
    kind: 'enum',
    candidates: ['whitebalance'],
    synonyms: {
      AUTO: ['auto', 'automatic', 'awb'],
      AUTO_WHITE_PRIORITY: ['autowhitepriority', 'whitepriority'],
      AUTO_AMBIENCE_PRIORITY: ['autoambiencepriority', 'ambiencepriority'],
      DAYLIGHT: ['daylight', 'fine', 'sunny'],
      SHADE: ['shade', 'shadow'],
      FLUORESCENT_1: ['fluorescent1', 'fluorescentlamp1', 'daylightfluorescent'],
      FLUORESCENT_2: ['fluorescent2', 'fluorescentlamp2', 'warmwhitefluorescent'],
      FLUORESCENT_3: ['fluorescent3', 'fluorescentlamp3', 'coolwhitefluorescent'],
      INCANDESCENT: ['incandescent', 'tungsten'],
      UNDERWATER: ['underwater'],
      KELVIN: ['kelvin', 'colortemperature', 'temperature'],
      CUSTOM_1: ['custom1', 'preset1', 'custom'],
      CUSTOM_2: ['custom2', 'preset2'],
      CUSTOM_3: ['custom3', 'preset3'],
    },
  },
  meteringMode: {
    kind: 'enum',
    candidates: ['exposuremetermode', 'meteringmode'],
    synonyms: {
      MULTI: ['multi', 'multispot', 'matrix', 'evaluative', 'pattern'],
      CENTER_WEIGHTED: ['centerweighted', 'centreweighted', 'center'],
      SPOT: ['spot', 'centerspot'],
      AVERAGE: ['average'],
    },
  },
  focusMode: {
    kind: 'enum',
    candidates: ['focusmode', 'focusmode2'],
    synonyms: {
      AF_S: ['afs', 'singleautofocus', 'single', 'oneshot', 'automatic'],
      AF_C: ['afc', 'continuousautofocus', 'continuous', 'aiservo'],
      MF: ['mf', 'manual', 'manualfocus'],
    },
  },
  driveMode: {
    kind: 'enum',
    candidates: ['capturemode', 'drivemode', 'stillcapturemode'],
    synonyms: {
      SINGLE: ['single', 'singleshot', 'normal', 'singleframe'],
      CONTINUOUS_LOW: ['continuouslow', 'burstlow', 'lowspeed', 'cl'],
      CONTINUOUS_HIGH: ['continuoushigh', 'bursthigh', 'highspeed', 'ch', 'burst'],
      BRACKET_AE: ['bracket', 'aebracket', 'exposurebracket'],
      HDR: ['hdr'],
    },
  },
  imageQuality: {
    kind: 'enum',
    candidates: ['imageformat', 'imagequality', 'compressionsetting'],
    synonyms: {
      FINE: ['fine', 'jpegfine', 'superfine'],
      NORMAL: ['normal', 'jpegnormal', 'standard'],
      FINE_RAW: ['rawfine', 'finerawjpeg', 'rawjpegfine', 'rawfine'],
      NORMAL_RAW: ['rawnormal', 'normalrawjpeg', 'rawjpegnormal'],
      RAW: ['raw'],
    },
  },
  filmSimulation: {
    kind: 'enum',
    candidates: ['filmsimulation', 'picturestyle', 'imagemode', 'colormode'],
    synonyms: {
      PROVIA_STD: ['provia', 'proviastandard', 'standard'],
      VELVIA_VIVID: ['velvia', 'velviavivid', 'vivid'],
      ASTIA_SOFT: ['astia', 'astiasoft', 'soft'],
      CLASSIC_CHROME: ['classicchrome'],
      PRO_NEG_HI: ['proneghi', 'pronegativehi', 'proneghigh'],
      PRO_NEG_STD: ['pronegstd', 'pronegativestd', 'pronegstandard'],
      CLASSIC_NEG: ['classicneg', 'classicnegative'],
      NOSTALGIC_NEG: ['nostalgicneg', 'nostalgicnegative'],
      ETERNA_CINEMA: ['eterna', 'eternacinema', 'cinema'],
      ETERNA_BLEACH_BYPASS: ['eternableachbypass', 'bleachbypass'],
      REALA_ACE: ['realaace', 'reala'],
      ACROS: ['acros'],
      ACROS_YE: ['acrosye', 'acrosyellow', 'acrosy'],
      ACROS_R: ['acrosr', 'acrosred'],
      ACROS_G: ['acrosg', 'acrosgreen'],
      MONOCHROME: ['monochrome', 'blackwhite', 'bw'],
      MONOCHROME_YE: ['monochromeye', 'monochromeyellow', 'bwye'],
      MONOCHROME_R: ['monochromer', 'monochromered', 'bwr'],
      MONOCHROME_G: ['monochromeg', 'monochromegreen', 'bwg'],
      SEPIA: ['sepia'],
    },
  },
  dynamicRange: {
    kind: 'enum',
    candidates: ['dynamicrange', 'drange'],
    synonyms: {
      DR100: ['100', 'dr100', 'p100'],
      DR200: ['200', 'dr200', 'p200'],
      DR400: ['400', 'dr400', 'p400'],
      DR_AUTO: ['auto', 'drauto'],
    },
  },
  colorChromeEffect: {
    kind: 'enum',
    candidates: ['colorchrome', 'colorchromeeffect'],
    synonyms: { OFF: ['off'], WEAK: ['weak'], STRONG: ['strong'] },
  },
  colorChromeFxBlue: {
    kind: 'enum',
    candidates: ['colorchromeblue', 'colorchromefxblue'],
    synonyms: { OFF: ['off'], WEAK: ['weak'], STRONG: ['strong'] },
  },
  ndFilter: {
    kind: 'enum',
    candidates: ['ndfilter', 'neutraldensity'],
    synonyms: { OFF: ['off'], ON: ['on'] },
  },

  // --- 光の調整（トーンカーブ）------------------------------------------
  // X100VI のハイライト/シャドウトーンは -2〜+4（0.5刻み）。
  // マイナスほど軟調（白飛び・黒潰れを避ける）、プラスほど硬調。
  highlightTone: {
    kind: 'number',
    candidates: ['highlighttone', 'highlight', 'highlighttonecurve', 'd08d'],
  },
  shadowTone: {
    kind: 'number',
    candidates: ['shadowtone', 'shadow', 'shadowtonecurve', 'd08e'],
  },
  clarity: { kind: 'number', candidates: ['clarity'] },
  sharpness: { kind: 'number', candidates: ['sharpness', 'sharpening'] },
  noiseReduction: {
    kind: 'number',
    candidates: ['noisereduction', 'highisonoisereduction', 'nrsetting'],
  },
  color: { kind: 'number', candidates: ['color', 'saturation', 'colorsaturation'] },

  // --- 色のバランス -------------------------------------------------------
  // X100VI の「RGBバランス」に当たるのは WBシフト。
  // 赤-シアン軸と青-黄軸の 2 軸で、それぞれ -9〜+9。
  // R/G/B を独立に持ち上げる機構はカメラ側に無い。
  wbShiftRed: {
    kind: 'number',
    candidates: ['whitebalanceadjusta', 'wbshiftra', 'colorshiftred', 'whitebalanceadjustred'],
  },
  wbShiftBlue: {
    kind: 'number',
    candidates: ['whitebalanceadjustb', 'wbshiftbb', 'colorshiftblue', 'whitebalanceadjustblue'],
  },
  whiteBalanceKelvin: {
    kind: 'number',
    candidates: ['colortemperature', 'whitebalancecolortemperature', 'colortemp'],
  },

  // --- その他の絵作り -----------------------------------------------------
  grainEffect: {
    kind: 'enum',
    candidates: ['graineffect', 'grain', 'grainroughness'],
    synonyms: {
      OFF: ['off'],
      WEAK_SMALL: ['weaksmall', 'weakssmall'],
      WEAK_LARGE: ['weaklarge'],
      STRONG_SMALL: ['strongsmall'],
      STRONG_LARGE: ['stronglarge'],
    },
  },
  dRangePriority: {
    kind: 'enum',
    candidates: ['drangepriority', 'dynamicrangepriority', 'drpriority'],
    synonyms: { OFF: ['off'], AUTO: ['auto'], WEAK: ['weak'], STRONG: ['strong'] },
  },

  // --- 撮影操作 -----------------------------------------------------------
  afArea: {
    kind: 'enum',
    candidates: ['afmode', 'focusarea', 'afareamode', 'aemode'],
    synonyms: {
      SINGLE_POINT: ['singlepoint', 'single', 'spot'],
      ZONE: ['zone'],
      WIDE_TRACKING: ['widetracking', 'wide', 'tracking', 'all'],
    },
  },
  subjectDetection: {
    kind: 'enum',
    candidates: ['subjectdetection', 'facedetection', 'subjectrecognition'],
    synonyms: {
      OFF: ['off'],
      FACE_EYE: ['faceeye', 'face', 'eye', 'faceon'],
      ANIMAL: ['animal'],
      BIRD: ['bird'],
      CAR: ['car', 'automobile'],
      BIKE: ['bike', 'motorcycle', 'bicycle'],
      AIRPLANE: ['airplane', 'aeroplane', 'plane'],
      TRAIN: ['train'],
    },
  },
  digitalTeleconverter: {
    kind: 'enum',
    candidates: ['digitalteleconverter', 'digitalzoom', 'teleconverter'],
    synonyms: {
      OFF: ['off', '35mm'],
      X1_4: ['50mm', 'x14', '14x'],
      X2_0: ['70mm', 'x20', '2x', '20x'],
    },
  },

  // --- ISOオートの枠 ------------------------------------------------------
  isoAutoMax: { kind: 'iso', candidates: ['isoautomax', 'isoautohigh', 'autoisomax'] },
  isoAutoMinShutterSec: {
    kind: 'shutter',
    candidates: ['isoautominshutter', 'autoisominshutterspeed', 'minshutterspeed'],
  },
};

export interface ResolvedField {
  field: keyof ShootingSettings;
  kind: FieldKind;
  path: string;
  /** widget の型（RADIO/MENU/RANGE/TEXT/TOGGLE）。 */
  type: string;
  readonly: boolean;
  /** 実機が返した選択肢（数値種別なら解釈済みの値つき）。 */
  choices: { index: number; value: string; parsed?: number | 'AUTO' }[];
  range?: { bottom: number; top: number; step: number };
  /** enum の照合結果。ドメイン値 → 選択肢インデックス。 */
  valueMap?: Record<string, number>;
  /** 照合できなかったドメイン値。 */
  unmatchedValues?: string[];
}

export interface MappingReport {
  resolved: ResolvedField[];
  /** 解決できなかったフィールドと、その理由。 */
  unresolved: { field: keyof ShootingSettings; reason: string }[];
}

/** 選択肢の文字列を種別に応じて数値化する。 */
function parseChoice(kind: FieldKind, value: string): number | 'AUTO' | undefined {
  switch (kind) {
    case 'aperture':
      return parseAperture(value);
    case 'shutter':
      return parseShutterSeconds(value);
    case 'iso':
      return parseIso(value);
    case 'expcomp':
      return parseExposureCompensation(value);
    case 'number':
      return parseSignedNumber(value);
    default:
      return undefined;
  }
}

/**
 * 選択肢とキーワードの一致度を採点する。
 *
 * 完全一致を最優先にしないと ACROS が "Acros+R" を拾ってしまう。
 * 部分一致はキーワード長で重み付けし、より具体的な語を優先する。
 */
function scoreChoice(choice: string, synonyms: string[]): number {
  const target = normalize(choice);
  let best = 0;
  for (const synonym of synonyms) {
    const key = normalize(synonym);
    if (key.length === 0) continue;
    if (target === key) best = Math.max(best, 1000);
    else if (target.includes(key)) best = Math.max(best, 100 + key.length);
  }
  return best;
}

/** 実機の設定ツリーから、扱えるフィールドを解決する。 */
export function resolveMapping(entries: readonly ConfigEntry[]): MappingReport {
  const byName = new Map<string, ConfigEntry[]>();
  for (const entry of entries) {
    const key = normalize(entry.name);
    const list = byName.get(key);
    if (list) list.push(entry);
    else byName.set(key, [entry]);
  }

  const resolved: ResolvedField[] = [];
  const unresolved: MappingReport['unresolved'] = [];

  for (const [field, spec] of Object.entries(FIELD_SPECS) as [
    keyof ShootingSettings,
    FieldSpec,
  ][]) {
    const match = spec.candidates
      .map((candidate) => byName.get(normalize(candidate))?.[0])
      .find((entry): entry is ConfigEntry => entry !== undefined);

    if (!match) {
      unresolved.push({
        field,
        reason: `候補 (${spec.candidates.join(', ')}) がカメラの設定ツリーに存在しません。`,
      });
      continue;
    }

    if (match.readonly) {
      unresolved.push({ field, reason: `${match.path} は読み取り専用です。` });
      continue;
    }

    const choices = match.choices.map((choice) => {
      const parsed = parseChoice(spec.kind, choice.value);
      return parsed === undefined
        ? { index: choice.index, value: choice.value }
        : { index: choice.index, value: choice.value, parsed };
    });

    const entry: ResolvedField = {
      field,
      kind: spec.kind,
      path: match.path,
      type: match.type,
      readonly: match.readonly,
      choices,
      ...(match.range ? { range: match.range } : {}),
    };

    if (spec.kind === 'enum' && spec.synonyms) {
      const valueMap: Record<string, number> = {};
      const unmatched: string[] = [];
      for (const [domainValue, synonyms] of Object.entries(spec.synonyms)) {
        let bestIndex: number | undefined;
        let bestScore = 0;
        for (const choice of choices) {
          const score = scoreChoice(choice.value, synonyms);
          if (score > bestScore) {
            bestScore = score;
            bestIndex = choice.index;
          }
        }
        if (bestIndex !== undefined) valueMap[domainValue] = bestIndex;
        else unmatched.push(domainValue);
      }
      entry.valueMap = valueMap;
      if (unmatched.length > 0) entry.unmatchedValues = unmatched;
    }

    resolved.push(entry);
  }

  return { resolved, unresolved };
}

export interface EncodedSet {
  path: string;
  /** 選択肢から選べた場合はインデックス指定（曖昧さが無く確実）。 */
  index?: number;
  /** RANGE/TEXT の場合は値の文字列。 */
  value?: string;
  /** UI 表示用に、実際にカメラへ渡す表記。 */
  display: string;
}

/** 対数距離で最も近い選択肢を選ぶ（絞り・SS・ISO 向け）。 */
function nearestLog(
  target: number,
  choices: ResolvedField['choices'],
): ResolvedField['choices'][number] | undefined {
  let best: ResolvedField['choices'][number] | undefined;
  let bestDistance = Infinity;
  for (const choice of choices) {
    if (typeof choice.parsed !== 'number' || choice.parsed <= 0) continue;
    const distance = Math.abs(Math.log2(choice.parsed) - Math.log2(target));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = choice;
    }
  }
  return best;
}

/** 線形距離で最も近い選択肢を選ぶ（露出補正向け）。 */
function nearestLinear(
  target: number,
  choices: ResolvedField['choices'],
): ResolvedField['choices'][number] | undefined {
  let best: ResolvedField['choices'][number] | undefined;
  let bestDistance = Infinity;
  for (const choice of choices) {
    if (typeof choice.parsed !== 'number') continue;
    const distance = Math.abs(choice.parsed - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = choice;
    }
  }
  return best;
}

/**
 * ドメイン値を gphoto2 への書き込み指示に変換する。
 * 変換できない場合は理由を返す（送信はしない）。
 */
export function encodeSet(
  resolved: ResolvedField,
  value: unknown,
): { set: EncodedSet } | { reason: string } {
  const { kind, path, choices } = resolved;

  if (kind === 'iso') {
    if (value === 'AUTO') {
      const auto = choices.find((choice) => choice.parsed === 'AUTO');
      if (!auto) return { reason: 'このカメラの ISO 設定に AUTO の選択肢がありません。' };
      return { set: { path, index: auto.index, display: auto.value } };
    }
    if (typeof value !== 'number') return { reason: `ISO の値が数値ではありません: ${String(value)}` };
    const nearest = nearestLog(value, choices);
    if (!nearest) return { reason: 'ISO の選択肢を解釈できませんでした。' };
    return { set: { path, index: nearest.index, display: nearest.value } };
  }

  if (kind === 'aperture' || kind === 'shutter') {
    if (typeof value !== 'number') return { reason: `値が数値ではありません: ${String(value)}` };
    if (choices.length > 0) {
      const nearest = nearestLog(value, choices);
      if (!nearest) return { reason: '選択肢を数値として解釈できませんでした。' };
      return { set: { path, index: nearest.index, display: nearest.value } };
    }
    // 選択肢を持たない RANGE/TEXT widget の場合は値をそのまま渡す
    return { set: { path, value: String(value), display: String(value) } };
  }

  if (kind === 'number') {
    if (typeof value !== 'number') return { reason: `値が数値ではありません: ${String(value)}` };

    if (choices.length > 0) {
      const nearest = nearestLinear(value, choices);
      if (!nearest) {
        return { reason: 'この設定の選択肢を数値として解釈できませんでした。' };
      }
      return { set: { path, index: nearest.index, display: nearest.value } };
    }

    // 選択肢を持たない RANGE widget は、カメラが申告した範囲と刻みに合わせる。
    // 範囲外の値を投げるとカメラが黙って別の値になることがあるため、ここで必ず丸める。
    if (resolved.range) {
      const { bottom, top, step } = resolved.range;
      const stepped = step > 0 ? Math.round(value / step) * step : value;
      const clamped = Math.min(top, Math.max(bottom, stepped));
      const rounded = Math.round(clamped * 1000) / 1000;
      return { set: { path, value: String(rounded), display: String(rounded) } };
    }

    return { set: { path, value: String(value), display: String(value) } };
  }

  if (kind === 'expcomp') {
    if (typeof value !== 'number') return { reason: `値が数値ではありません: ${String(value)}` };
    if (choices.length > 0) {
      const nearest = nearestLinear(value, choices);
      if (!nearest) return { reason: '露出補正の選択肢を解釈できませんでした。' };
      return { set: { path, index: nearest.index, display: nearest.value } };
    }
    return { set: { path, value: String(value), display: `${value} EV` } };
  }

  if (kind === 'enum') {
    if (typeof value !== 'string') return { reason: `値が文字列ではありません: ${String(value)}` };
    const index = resolved.valueMap?.[value];
    if (index === undefined) {
      return {
        reason: `「${value}」に対応する選択肢がカメラにありません（このカメラの選択肢: ${choices.map((c) => c.value).join(' / ') || 'なし'}）。`,
      };
    }
    const choice = choices.find((c) => c.index === index);
    return { set: { path, index, display: choice?.value ?? String(index) } };
  }

  return { reason: `未対応の値種別です: ${kind}` };
}
