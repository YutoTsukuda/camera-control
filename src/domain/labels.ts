/**
 * 設定値の日本語表示名。
 * サーバの /api/capabilities で配信し、スマホ UI と AI プロンプトの両方で使う。
 */
import type {
  AfArea,
  ColorChrome,
  DRangePriority,
  DriveMode,
  DynamicRange,
  ExposureMode,
  FilmSimulation,
  FocusMode,
  GrainEffect,
  ImageQuality,
  MeteringMode,
  ShutterType,
  SubjectDetection,
  WhiteBalance,
} from './types.js';

export const FILM_SIMULATION_LABELS: Record<FilmSimulation, string> = {
  PROVIA_STD: 'PROVIA / スタンダード',
  VELVIA_VIVID: 'Velvia / ビビッド',
  ASTIA_SOFT: 'ASTIA / ソフト',
  CLASSIC_CHROME: 'クラシッククローム',
  PRO_NEG_HI: 'PRO Neg. Hi',
  PRO_NEG_STD: 'PRO Neg. Std',
  CLASSIC_NEG: 'クラシックネガ',
  NOSTALGIC_NEG: 'ノスタルジックネガ',
  ETERNA_CINEMA: 'ETERNA / シネマ',
  ETERNA_BLEACH_BYPASS: 'ETERNA ブリーチバイパス',
  REALA_ACE: 'REALA ACE',
  ACROS: 'ACROS',
  ACROS_YE: 'ACROS + Yeフィルター',
  ACROS_R: 'ACROS + Rフィルター',
  ACROS_G: 'ACROS + Gフィルター',
  MONOCHROME: 'モノクロ',
  MONOCHROME_YE: 'モノクロ + Yeフィルター',
  MONOCHROME_R: 'モノクロ + Rフィルター',
  MONOCHROME_G: 'モノクロ + Gフィルター',
  SEPIA: 'セピア',
};

/** 各フィルムシミュレーションの性格。AI プロンプトに載せて選定の根拠を与える。 */
export const FILM_SIMULATION_NOTES: Record<FilmSimulation, string> = {
  PROVIA_STD: '万能。迷ったらこれ。忠実で扱いやすい',
  VELVIA_VIVID: '高彩度・高コントラスト。風景や紅葉向き。人肌は転びやすい',
  ASTIA_SOFT: '軟調で肌色が上品。ポートレート向き',
  CLASSIC_CHROME: '彩度を抑えた渋い発色。ドキュメンタリー・街撮り',
  PRO_NEG_HI: 'やや硬調な人物用。屋外ポートレート',
  PRO_NEG_STD: '軟調な人物用。スタジオ・物撮り',
  CLASSIC_NEG: '色が強く転ぶ個性派。スナップ・スチール感',
  NOSTALGIC_NEG: 'アンバー寄りの琥珀色。ノスタルジックな家族写真',
  ETERNA_CINEMA: '低彩度・低コントラストの映画調。動画的な質感',
  ETERNA_BLEACH_BYPASS: '銀残し。低彩度・高コントラストで硬質',
  REALA_ACE: '忠実な色再現と硬めの階調。記録性と質感を両立',
  ACROS: '粒状感の美しい白黒。X100VI の白黒はこれが基本',
  ACROS_YE: '白黒＋黄フィルター。空をやや締める',
  ACROS_R: '白黒＋赤フィルター。空を強く締めコントラスト最大',
  ACROS_G: '白黒＋緑フィルター。人肌の階調を残す',
  MONOCHROME: '素直な白黒。ACROS より平坦',
  MONOCHROME_YE: '白黒＋黄フィルター',
  MONOCHROME_R: '白黒＋赤フィルター',
  MONOCHROME_G: '白黒＋緑フィルター',
  SEPIA: 'セピア調',
};

export const WHITE_BALANCE_LABELS: Record<WhiteBalance, string> = {
  AUTO: 'オート',
  AUTO_WHITE_PRIORITY: 'オート（ホワイト優先）',
  AUTO_AMBIENCE_PRIORITY: 'オート（雰囲気優先）',
  DAYLIGHT: '晴れ',
  SHADE: '日陰',
  FLUORESCENT_1: '蛍光灯1（昼光色）',
  FLUORESCENT_2: '蛍光灯2（昼白色）',
  FLUORESCENT_3: '蛍光灯3（白色）',
  INCANDESCENT: '白熱電球',
  UNDERWATER: '水中',
  KELVIN: '色温度指定',
  CUSTOM_1: 'カスタム1',
  CUSTOM_2: 'カスタム2',
  CUSTOM_3: 'カスタム3',
};

export const EXPOSURE_MODE_LABELS: Record<ExposureMode, string> = {
  P: 'プログラム(P)',
  A: '絞り優先(A)',
  S: 'シャッター優先(S)',
  M: 'マニュアル(M)',
};

export const SHUTTER_TYPE_LABELS: Record<ShutterType, string> = {
  MS: 'メカニカルシャッター',
  ES: '電子シャッター（無音）',
  'MS+ES': 'メカ＋電子（自動切替）',
};

export const DYNAMIC_RANGE_LABELS: Record<DynamicRange, string> = {
  DR100: 'DR100%',
  DR200: 'DR200%',
  DR400: 'DR400%',
  DR_AUTO: 'DRオート',
};

export const D_RANGE_PRIORITY_LABELS: Record<DRangePriority, string> = {
  OFF: 'OFF',
  AUTO: 'オート',
  WEAK: '弱',
  STRONG: '強',
};

export const METERING_LABELS: Record<MeteringMode, string> = {
  MULTI: 'マルチ',
  CENTER_WEIGHTED: '中央重点',
  SPOT: 'スポット',
  AVERAGE: 'アベレージ',
};

export const FOCUS_MODE_LABELS: Record<FocusMode, string> = {
  AF_S: 'AF-S（シングル）',
  AF_C: 'AF-C（コンティニュアス）',
  MF: 'MF（マニュアル）',
};

export const AF_AREA_LABELS: Record<AfArea, string> = {
  SINGLE_POINT: 'シングルポイント',
  ZONE: 'ゾーン',
  WIDE_TRACKING: 'ワイド/トラッキング',
};

export const SUBJECT_DETECTION_LABELS: Record<SubjectDetection, string> = {
  OFF: 'OFF',
  FACE_EYE: '顔・瞳',
  ANIMAL: '動物',
  BIRD: '鳥',
  CAR: '車',
  BIKE: 'バイク・自転車',
  AIRPLANE: '飛行機',
  TRAIN: '電車',
};

export const DRIVE_MODE_LABELS: Record<DriveMode, string> = {
  SINGLE: '1コマ',
  CONTINUOUS_LOW: '連写 低速',
  CONTINUOUS_HIGH: '連写 高速',
  BRACKET_AE: 'AEブラケット',
  HDR: 'HDR',
};

export const IMAGE_QUALITY_LABELS: Record<ImageQuality, string> = {
  FINE: 'FINE（JPEG）',
  NORMAL: 'NORMAL（JPEG）',
  FINE_RAW: 'FINE + RAW',
  NORMAL_RAW: 'NORMAL + RAW',
  RAW: 'RAWのみ',
};

export const GRAIN_LABELS: Record<GrainEffect, string> = {
  OFF: 'OFF',
  WEAK_SMALL: '弱・小',
  WEAK_LARGE: '弱・大',
  STRONG_SMALL: '強・小',
  STRONG_LARGE: '強・大',
};

export const COLOR_CHROME_LABELS: Record<ColorChrome, string> = {
  OFF: 'OFF',
  WEAK: '弱',
  STRONG: '強',
};

/** 設定フィールド名の日本語ラベル。補正ログの表示に使う。 */
export const FIELD_LABELS: Record<string, string> = {
  exposureMode: '露出モード',
  aperture: '絞り',
  shutterSpeedSec: 'シャッター速度',
  iso: 'ISO感度',
  isoAutoMax: 'ISO AUTO上限',
  isoAutoMinShutterSec: 'ISO AUTO低速限界',
  exposureCompensation: '露出補正',
  shutterType: 'シャッター方式',
  ndFilter: 'NDフィルター',
  filmSimulation: 'フィルムシミュレーション',
  whiteBalance: 'ホワイトバランス',
  whiteBalanceKelvin: '色温度',
  wbShiftRed: 'WBシフト(R)',
  wbShiftBlue: 'WBシフト(B)',
  dynamicRange: 'ダイナミックレンジ',
  dRangePriority: 'Dレンジ優先',
  highlightTone: 'ハイライトトーン',
  shadowTone: 'シャドウトーン',
  color: 'カラー',
  sharpness: 'シャープネス',
  noiseReduction: 'ノイズリダクション',
  clarity: 'クラリティ',
  grainEffect: 'グレイン・エフェクト',
  colorChromeEffect: 'カラークロームエフェクト',
  colorChromeFxBlue: 'カラークロームブルー',
  meteringMode: '測光モード',
  focusMode: 'フォーカスモード',
  afArea: 'AFエリア',
  subjectDetection: '被写体検出',
  driveMode: 'ドライブモード',
  imageQuality: '画質モード',
  digitalTeleconverter: 'デジタルテレコン',
  exposure: '露出',
};
