/**
 * FUJIFILM X100VI 静止画撮影設定のドメイン型定義。
 *
 * ここで定義する `ShootingSettings` が、
 *   AI提案 → 検証/丸め込み → カメラ適用
 * の全レイヤーで流通する唯一の正規表現（canonical representation）。
 */

/** 露出モード。X100VI は絞りリング/SSダイヤルの A ポジションの組み合わせで決まる。 */
export type ExposureMode = 'P' | 'A' | 'S' | 'M';

/** シャッター方式。MS=メカニカル(リーフ), ES=電子, MS+ES=自動切替。 */
export type ShutterType = 'MS' | 'ES' | 'MS+ES';

export type FilmSimulation =
  | 'PROVIA_STD'
  | 'VELVIA_VIVID'
  | 'ASTIA_SOFT'
  | 'CLASSIC_CHROME'
  | 'PRO_NEG_HI'
  | 'PRO_NEG_STD'
  | 'CLASSIC_NEG'
  | 'NOSTALGIC_NEG'
  | 'ETERNA_CINEMA'
  | 'ETERNA_BLEACH_BYPASS'
  | 'REALA_ACE'
  | 'ACROS'
  | 'ACROS_YE'
  | 'ACROS_R'
  | 'ACROS_G'
  | 'MONOCHROME'
  | 'MONOCHROME_YE'
  | 'MONOCHROME_R'
  | 'MONOCHROME_G'
  | 'SEPIA';

export type WhiteBalance =
  | 'AUTO'
  | 'AUTO_WHITE_PRIORITY'
  | 'AUTO_AMBIENCE_PRIORITY'
  | 'DAYLIGHT'
  | 'SHADE'
  | 'FLUORESCENT_1'
  | 'FLUORESCENT_2'
  | 'FLUORESCENT_3'
  | 'INCANDESCENT'
  | 'UNDERWATER'
  | 'KELVIN'
  | 'CUSTOM_1'
  | 'CUSTOM_2'
  | 'CUSTOM_3';

export type DynamicRange = 'DR100' | 'DR200' | 'DR400' | 'DR_AUTO';
export type DRangePriority = 'OFF' | 'AUTO' | 'WEAK' | 'STRONG';
export type MeteringMode = 'MULTI' | 'CENTER_WEIGHTED' | 'SPOT' | 'AVERAGE';
export type FocusMode = 'AF_S' | 'AF_C' | 'MF';
export type AfArea = 'SINGLE_POINT' | 'ZONE' | 'WIDE_TRACKING';
export type SubjectDetection =
  | 'OFF'
  | 'FACE_EYE'
  | 'ANIMAL'
  | 'BIRD'
  | 'CAR'
  | 'BIKE'
  | 'AIRPLANE'
  | 'TRAIN';
export type DriveMode = 'SINGLE' | 'CONTINUOUS_LOW' | 'CONTINUOUS_HIGH' | 'BRACKET_AE' | 'HDR';
export type ImageQuality = 'FINE' | 'NORMAL' | 'FINE_RAW' | 'NORMAL_RAW' | 'RAW';
export type NdFilter = 'OFF' | 'ON';
export type GrainEffect = 'OFF' | 'WEAK_SMALL' | 'WEAK_LARGE' | 'STRONG_SMALL' | 'STRONG_LARGE';
export type ColorChrome = 'OFF' | 'WEAK' | 'STRONG';
export type DigitalTeleconverter = 'OFF' | 'X1_4' | 'X2_0';

/**
 * カメラに書き込む静止画設定一式。
 *
 * すべて任意項目。AI が言及しなかった項目は `undefined` のままとし、
 * カメラ側の現在値を維持する（＝差分適用）。
 */
export interface ShootingSettings {
  exposureMode?: ExposureMode;
  /** F値。例: 2, 2.8, 5.6 */
  aperture?: number;
  /** シャッター速度[秒]。例: 1/250 → 0.004 */
  shutterSpeedSec?: number;
  /** ISO感度。`'AUTO'` で ISO オート。 */
  iso?: number | 'AUTO';
  /** ISO AUTO 時の上限感度。 */
  isoAutoMax?: number;
  /** ISO AUTO 時の低速シャッター限界[秒]。 */
  isoAutoMinShutterSec?: number;
  /** 露出補正[EV]。 */
  exposureCompensation?: number;
  shutterType?: ShutterType;
  ndFilter?: NdFilter;

  filmSimulation?: FilmSimulation;
  whiteBalance?: WhiteBalance;
  /** whiteBalance === 'KELVIN' のときの色温度[K]。 */
  whiteBalanceKelvin?: number;
  /** WBシフト。赤-シアン / 青-黄 方向、それぞれ -9..+9。 */
  wbShiftRed?: number;
  wbShiftBlue?: number;

  dynamicRange?: DynamicRange;
  dRangePriority?: DRangePriority;
  highlightTone?: number;
  shadowTone?: number;
  color?: number;
  sharpness?: number;
  noiseReduction?: number;
  clarity?: number;
  grainEffect?: GrainEffect;
  colorChromeEffect?: ColorChrome;
  colorChromeFxBlue?: ColorChrome;

  meteringMode?: MeteringMode;
  focusMode?: FocusMode;
  afArea?: AfArea;
  subjectDetection?: SubjectDetection;
  driveMode?: DriveMode;
  imageQuality?: ImageQuality;
  digitalTeleconverter?: DigitalTeleconverter;
}

/** 撮影意図。UI から渡される、AI への入力コンテキスト。 */
export interface ShootingIntent {
  /** 自由記述の指示。例: 「逆光の人物を柔らかく」 */
  note?: string;
  /** 被写体の種類。 */
  subject?: 'PERSON' | 'LANDSCAPE' | 'STREET' | 'FOOD' | 'ANIMAL' | 'ARCHITECTURE' | 'NIGHT' | 'MACRO' | 'SPORTS' | 'OTHER';
  /** 表現の優先軸。 */
  priority?: 'BOKEH' | 'SHARPNESS' | 'FREEZE_MOTION' | 'LOW_NOISE' | 'MOOD' | 'BALANCED';
  /** 被写体の動きの速さ。 */
  motion?: 'STILL' | 'SLOW' | 'FAST';
  /** 保持方法。三脚なら低速SSを許容できる。 */
  support?: 'HANDHELD' | 'TRIPOD';
  /** RAWも残すか。 */
  wantRaw?: boolean;
  /** モノクロ希望。 */
  monochrome?: boolean;
}

/** シーンの明るさ・状況。カメラの測光値または UI/AI 推定で埋まる。 */
export interface SceneContext {
  /** ISO100 換算の被写体輝度 EV。晴天屋外 ≒ 15、室内 ≒ 6-7。 */
  ev100?: number;
  /** 逆光かどうか。 */
  backlit?: boolean;
  /** 光源の色。 */
  lightSource?: 'DAYLIGHT' | 'SHADE' | 'CLOUDY' | 'TUNGSTEN' | 'FLUORESCENT' | 'MIXED' | 'NEON' | 'UNKNOWN';
  /** ダイナミックレンジの厳しさ(0:平坦 〜 1:白飛び黒潰れ寸前)。 */
  contrast?: number;
}

/** 設定の検証で発生した補正の記録。UI にそのまま表示する。 */
export interface Correction {
  field: keyof ShootingSettings | 'exposure';
  /** 補正前の値（JSON化可能な形）。 */
  from: unknown;
  to: unknown;
  /** 日本語の理由。ユーザーに提示する。 */
  reason: string;
  /**
   * note: 値は変えていない補足説明（例: 「A モードではSSはカメラが決めます」）
   * info: 値を変えたが撮影結果への影響は小さい
   * warn: 意図どおりに撮れない可能性がある
   */
  severity: 'note' | 'info' | 'warn';
}

export interface SettingsProposal {
  settings: ShootingSettings;
  /** 提案理由（日本語、2-4文）。 */
  rationale: string;
  /** 0..1。低い場合 UI で確認を促す。 */
  confidence: number;
  /** 提案の出どころ。 */
  source: 'claude' | 'rules';
  /** 検証レイヤーが加えた補正。 */
  corrections: Correction[];
  /** 実現できた露出の EV100 換算値（露出が確定した場合のみ）。 */
  resolvedEv100?: number;
  /**
   * ソルバが算出した露出の実測予測。
   *
   * 絞り優先(A)＋ISOオートで運用する場合、ISO とシャッター速度を決めるのは
   * カメラ自身なので `settings` には具体値を書き込まない。それでも撮影者は
   * 「だいたい 1/250・ISO400 あたりに落ちる」と知りたいので、
   * 予測値をここに分けて持たせ、UI で参考表示する。
   */
  predictedExposure?: {
    aperture: number;
    shutterSpeedSec: number;
    iso: number;
    ndFilter: 'ON' | 'OFF';
  };
  /** 撮影時の注意点（日本語）。 */
  warnings?: string[];
  /** シーンの読み取り結果（日本語）。 */
  sceneAnalysis?: string;
}
