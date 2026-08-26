/**
 * FUJIFILM X100VI の設定可能値テーブル。
 *
 * 出典: X100VI 取扱説明書 / 製品仕様。数値の正確さがこのシステムの土台なので、
 * 実機仕様と食い違いを見つけたらこのファイルだけを直せば全レイヤーに波及する。
 *
 * 注意: 一部（連写コマ数など）は撮影設定の自動決定に影響しないため未収録。
 */
import type {
  DriveMode,
  DynamicRange,
  FilmSimulation,
  ImageQuality,
  ShutterType,
  WhiteBalance,
} from './types.js';

/** 固定レンズ 23mm F2（35mm判換算 35mm 相当）。 */
export const FOCAL_LENGTH_MM = 23;
export const FOCAL_LENGTH_EQUIV_MM = 35;

/** 絞り: F2〜F16 の 1/3 段刻み。 */
export const APERTURES: readonly number[] = [
  2, 2.2, 2.5, 2.8, 3.2, 3.6, 4, 4.5, 5, 5.6, 6.4, 7.1, 8, 9, 10, 11, 13, 14, 16,
];

/**
 * リーフシャッターの絞り依存の最高速。
 *
 * X100 シリーズのレンズシャッターは開口が大きいほど最高速が下がる。
 * 開放 F2 では 1/1000 秒までしか切れないため、日中の開放撮影では
 * NDフィルター（内蔵4段）か電子シャッターが必須になる。
 * この制約が X100VI 特有の最も引っかかりやすい落とし穴なので、
 * 露出ソルバとバリデータの両方でここを参照する。
 */
export const LEAF_SHUTTER_LIMITS: readonly { maxAperture: number; fastestSec: number }[] = [
  { maxAperture: 2.5, fastestSec: 1 / 1000 },
  { maxAperture: 3.6, fastestSec: 1 / 2000 },
  { maxAperture: 16, fastestSec: 1 / 4000 },
];

/** 内蔵NDフィルターの減光量[段]。 */
export const ND_FILTER_STOPS = 4;

/**
 * 指定絞りでメカニカルシャッターが切れる最高速[秒]を返す。
 */
export function mechanicalFastestSec(aperture: number): number {
  for (const row of LEAF_SHUTTER_LIMITS) {
    if (aperture <= row.maxAperture + 1e-9) return row.fastestSec;
  }
  const last = LEAF_SHUTTER_LIMITS[LEAF_SHUTTER_LIMITS.length - 1];
  return last ? last.fastestSec : 1 / 4000;
}

/** 1/3段刻みのシャッター速度[秒]を、遅い順に生成する。 */
function buildShutterLadder(): number[] {
  // 長秒側（秒単位）
  const longSeconds = [
    30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3.2, 2.5, 2, 1.6, 1.3, 1,
  ];
  // 短秒側（分母）
  const denominators = [
    1.3, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10, 13, 15, 20, 25, 30, 40, 50, 60, 80, 100,
    125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500,
    3200, 4000,
    // 電子シャッター領域
    5000, 6400, 8000, 10000, 13000, 16000, 20000, 25000, 32000, 40000, 50000,
    64000, 80000, 100000, 125000, 160000, 180000,
  ];
  return [...longSeconds, ...denominators.map((d) => 1 / d)];
}

/** 全シャッター速度（遅い→速い）。メカ/電子の判定は別途 `fastestShutterSec` で行う。 */
export const SHUTTER_SPEEDS: readonly number[] = Object.freeze(buildShutterLadder());

/** シャッター方式ごとの最長秒時。 */
export const SLOWEST_SHUTTER_SEC = 30;

/** シャッター方式と絞りから、実際に切れる最高速[秒]を返す。 */
export function fastestShutterSec(shutterType: ShutterType, aperture: number): number {
  if (shutterType === 'ES') return 1 / 180000;
  const mech = mechanicalFastestSec(aperture);
  // MS+ES は上限を超えると自動で電子に切り替わる
  return shutterType === 'MS+ES' ? 1 / 180000 : mech;
}

/** 常用ISO感度（1/3段刻み）。 */
export const ISO_NATIVE: readonly number[] = [
  125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500,
  3200, 4000, 5000, 6400, 8000, 10000, 12800,
];
/** 拡張低感度（ダイナミックレンジが狭まる）。 */
export const ISO_EXTENDED_LOW: readonly number[] = [64, 80, 100];
/** 拡張高感度（JPEGのみ）。 */
export const ISO_EXTENDED_HIGH: readonly number[] = [25600, 51200];
export const ISO_ALL: readonly number[] = [
  ...ISO_EXTENDED_LOW,
  ...ISO_NATIVE,
  ...ISO_EXTENDED_HIGH,
];
/** 画質を優先するときの実用上限（AI提案の既定ガード）。 */
export const ISO_PRACTICAL_MAX = 12800;

/** 露出補正の範囲[EV]と刻み。 */
export const EXPOSURE_COMPENSATION_RANGE = { min: -5, max: 5, step: 1 / 3 };

/** ダイナミックレンジ設定に必要な最低ISO感度。 */
export const DR_MIN_ISO: Readonly<Record<DynamicRange, number>> = {
  DR100: 0,
  DR200: 250,
  DR400: 500,
  DR_AUTO: 0,
};

export const FILM_SIMULATIONS: readonly FilmSimulation[] = [
  'PROVIA_STD',
  'VELVIA_VIVID',
  'ASTIA_SOFT',
  'CLASSIC_CHROME',
  'PRO_NEG_HI',
  'PRO_NEG_STD',
  'CLASSIC_NEG',
  'NOSTALGIC_NEG',
  'ETERNA_CINEMA',
  'ETERNA_BLEACH_BYPASS',
  'REALA_ACE',
  'ACROS',
  'ACROS_YE',
  'ACROS_R',
  'ACROS_G',
  'MONOCHROME',
  'MONOCHROME_YE',
  'MONOCHROME_R',
  'MONOCHROME_G',
  'SEPIA',
];

/** モノクロ系フィルムシミュレーション（`color` パラメータが効かない）。 */
export const MONOCHROME_SIMULATIONS: readonly FilmSimulation[] = [
  'ACROS',
  'ACROS_YE',
  'ACROS_R',
  'ACROS_G',
  'MONOCHROME',
  'MONOCHROME_YE',
  'MONOCHROME_R',
  'MONOCHROME_G',
  'SEPIA',
];

export const WHITE_BALANCES: readonly WhiteBalance[] = [
  'AUTO',
  'AUTO_WHITE_PRIORITY',
  'AUTO_AMBIENCE_PRIORITY',
  'DAYLIGHT',
  'SHADE',
  'FLUORESCENT_1',
  'FLUORESCENT_2',
  'FLUORESCENT_3',
  'INCANDESCENT',
  'UNDERWATER',
  'KELVIN',
  'CUSTOM_1',
  'CUSTOM_2',
  'CUSTOM_3',
];

export const KELVIN_RANGE = { min: 2500, max: 10000 };
export const WB_SHIFT_RANGE = { min: -9, max: 9 };

/** 画質調整パラメータの範囲。 */
export const TONE_RANGES = {
  highlightTone: { min: -2, max: 4, step: 0.5 },
  shadowTone: { min: -2, max: 4, step: 0.5 },
  color: { min: -4, max: 4, step: 1 },
  sharpness: { min: -4, max: 4, step: 1 },
  noiseReduction: { min: -4, max: 4, step: 1 },
  clarity: { min: -5, max: 5, step: 1 },
} as const;

export const DRIVE_MODES: readonly DriveMode[] = [
  'SINGLE',
  'CONTINUOUS_LOW',
  'CONTINUOUS_HIGH',
  'BRACKET_AE',
  'HDR',
];

export const IMAGE_QUALITIES: readonly ImageQuality[] = [
  'FINE',
  'NORMAL',
  'FINE_RAW',
  'NORMAL_RAW',
  'RAW',
];

/** RAW を含む画質設定（拡張ISOと排他）。 */
export const RAW_QUALITIES: readonly ImageQuality[] = ['FINE_RAW', 'NORMAL_RAW', 'RAW'];

/**
 * ボディ内手ブレ補正（IBIS）の実効段数。
 *
 * カタログ値は最大6.0段だが、歩留まりを見て保守的に 4 段を採用する。
 * 手持ち限界シャッター速度の計算に使う。
 */
export const IBIS_EFFECTIVE_STOPS = 4;

/** デジタルテレコン使用時の実効焦点距離（35mm判換算）。 */
export const TELECONVERTER_EQUIV_MM = { OFF: 35, X1_4: 50, X2_0: 70 } as const;
