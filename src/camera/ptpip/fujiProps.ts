/**
 * 設定フィールド ↔ PTP デバイスプロパティの対応表。
 *
 * ## 確度について（重要）
 *
 * PTP 標準で定義されたプロパティ（0x50xx）は仕様が公開されており、
 * コードもデータ型も確定している（confidence: 'standard'）。
 *
 * 一方、フィルムシミュレーションのような富士フイルム独自のプロパティ（0xD0xx 以降）は
 * 公開仕様が無く、コミュニティによる解析に基づく値である（confidence: 'community' / 'unverified'）。
 * 機種やファームウェアで変わる可能性があるため、
 * **実機での検証なしに本番運用してはいけない**。
 *
 * そのため独自プロパティは JSON で丸ごと差し替えられるようにしてある:
 *   1. `npm run discover -- --host 192.168.0.1` で実機の対応プロパティを一覧化
 *   2. `config/fuji-properties.json` に正しいコード/値を記述
 *   3. 再起動すればこの表が上書きされる（コード変更不要）
 */
import { PtpDataType } from './ptp.js';
import type { ShootingSettings } from '../../domain/types.js';

export type Confidence = 'standard' | 'community' | 'unverified';

export interface PropertyBinding {
  field: keyof ShootingSettings;
  code: number;
  dataType: PtpDataType;
  confidence: Confidence;
  /**
   * ドメイン値を PTP の数値へ変換する。
   * `null` を返した場合、そのフィールドは送信しない（カメラ側の自動制御に委ねる）。
   */
  encode: (value: unknown, settings: ShootingSettings) => number | null;
  /** 列挙型の場合の値表。JSON オーバーライドの対象。 */
  values?: Record<string, number>;
  note?: string;
}

/** 列挙値表から encode を作る。未知の値は送信しない。 */
function enumEncoder(values: Record<string, number>) {
  return (value: unknown): number | null => {
    if (typeof value !== 'string') return null;
    const mapped = values[value];
    return mapped === undefined ? null : mapped;
  };
}

// --- PTP 標準プロパティ (0x50xx) ------------------------------------------

/** F値は 100 倍の整数で表す（F2.8 → 280）。 */
const encodeFNumber = (value: unknown): number | null =>
  typeof value === 'number' ? Math.round(value * 100) : null;

/** 露光時間は 0.1ms 単位（1/250秒 = 4ms = 40）。 */
const encodeExposureTime = (value: unknown): number | null =>
  typeof value === 'number' ? Math.max(1, Math.round(value * 10000)) : null;

/** 露出補正は 1/1000 EV 単位（+1EV → 1000）。 */
const encodeExposureBias = (value: unknown): number | null =>
  typeof value === 'number' ? Math.round(value * 1000) : null;

/** ISO。'AUTO' は専用値 0xFFFF を使う（PTP の慣例）。 */
const encodeIso = (value: unknown): number | null => {
  if (value === 'AUTO') return 0xffff;
  return typeof value === 'number' ? Math.round(value) : null;
};

const EXPOSURE_PROGRAM_VALUES: Record<string, number> = {
  M: 1,
  P: 2,
  A: 3,
  S: 4,
};

const WHITE_BALANCE_VALUES: Record<string, number> = {
  AUTO: 2,
  AUTO_WHITE_PRIORITY: 2,
  AUTO_AMBIENCE_PRIORITY: 2,
  DAYLIGHT: 4,
  FLUORESCENT_1: 5,
  FLUORESCENT_2: 5,
  FLUORESCENT_3: 5,
  INCANDESCENT: 6,
  CUSTOM_1: 1,
  CUSTOM_2: 1,
  CUSTOM_3: 1,
  // SHADE / UNDERWATER / KELVIN は PTP 標準に該当値が無く、
  // ベンダ定義（0x8000〜）が必要。config で上書きすること。
};

const METERING_VALUES: Record<string, number> = {
  AVERAGE: 1,
  CENTER_WEIGHTED: 2,
  MULTI: 3,
  SPOT: 4,
};

const FOCUS_MODE_VALUES: Record<string, number> = {
  MF: 1,
  AF_S: 2,
  AF_C: 3,
};

const DRIVE_MODE_VALUES: Record<string, number> = {
  SINGLE: 1,
  CONTINUOUS_LOW: 2,
  CONTINUOUS_HIGH: 2,
  BRACKET_AE: 2,
  HDR: 2,
};

// --- 富士フイルム独自プロパティ（要検証） --------------------------------

const FILM_SIMULATION_VALUES: Record<string, number> = {
  PROVIA_STD: 0x0001,
  VELVIA_VIVID: 0x0002,
  ASTIA_SOFT: 0x0003,
  MONOCHROME: 0x0004,
  SEPIA: 0x0005,
  PRO_NEG_HI: 0x0006,
  PRO_NEG_STD: 0x0007,
  MONOCHROME_YE: 0x0008,
  MONOCHROME_R: 0x0009,
  MONOCHROME_G: 0x000a,
  CLASSIC_CHROME: 0x000b,
  ACROS: 0x000c,
  ACROS_YE: 0x000d,
  ACROS_R: 0x000e,
  ACROS_G: 0x000f,
  ETERNA_CINEMA: 0x0010,
  CLASSIC_NEG: 0x0011,
  ETERNA_BLEACH_BYPASS: 0x0012,
  NOSTALGIC_NEG: 0x0013,
  REALA_ACE: 0x0014,
};

const DYNAMIC_RANGE_VALUES: Record<string, number> = {
  DR_AUTO: 0xffff,
  DR100: 100,
  DR200: 200,
  DR400: 400,
};

/**
 * 既定のバインディング表。
 * `config/fuji-properties.json` の内容でフィールド単位に上書きされる。
 */
export const DEFAULT_BINDINGS: readonly PropertyBinding[] = [
  {
    field: 'exposureMode',
    code: 0x500e,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    values: EXPOSURE_PROGRAM_VALUES,
    encode: enumEncoder(EXPOSURE_PROGRAM_VALUES),
    note: 'PTP ExposureProgramMode。X100VI は絞りリングとSSダイヤルの物理位置が優先されるため、リモートからの変更が拒否されることがある。',
  },
  {
    field: 'aperture',
    code: 0x5007,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    encode: encodeFNumber,
    note: 'PTP FNumber。F値の100倍。絞りリングが A 以外の位置にあると拒否される。',
  },
  {
    field: 'shutterSpeedSec',
    code: 0x500d,
    dataType: PtpDataType.UINT32,
    confidence: 'standard',
    encode: encodeExposureTime,
    note: 'PTP ExposureTime。0.1ms 単位。SSダイヤルが A 以外だと拒否される。',
  },
  {
    field: 'iso',
    code: 0x500f,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    encode: encodeIso,
    note: 'PTP ExposureIndex。0xFFFF が AUTO。',
  },
  {
    field: 'exposureCompensation',
    code: 0x5010,
    dataType: PtpDataType.INT16,
    confidence: 'standard',
    encode: encodeExposureBias,
    note: 'PTP ExposureBiasCompensation。1/1000 EV 単位。',
  },
  {
    field: 'whiteBalance',
    code: 0x5005,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    values: WHITE_BALANCE_VALUES,
    encode: enumEncoder(WHITE_BALANCE_VALUES),
    note: '日陰・水中・色温度指定はベンダ定義値が必要。config で補完すること。',
  },
  {
    field: 'meteringMode',
    code: 0x500b,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    values: METERING_VALUES,
    encode: enumEncoder(METERING_VALUES),
  },
  {
    field: 'focusMode',
    code: 0x500a,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    values: FOCUS_MODE_VALUES,
    encode: enumEncoder(FOCUS_MODE_VALUES),
    note: 'X100VI はフォーカスモードが物理レバーのため、リモート変更は効かない可能性が高い。',
  },
  {
    field: 'driveMode',
    code: 0x5013,
    dataType: PtpDataType.UINT16,
    confidence: 'standard',
    values: DRIVE_MODE_VALUES,
    encode: enumEncoder(DRIVE_MODE_VALUES),
    note: 'PTP StillCaptureMode は 1コマ/連写 程度しか区別できない。細分化にはベンダ値が必要。',
  },
  {
    field: 'filmSimulation',
    code: 0xd001,
    dataType: PtpDataType.UINT16,
    confidence: 'unverified',
    values: FILM_SIMULATION_VALUES,
    encode: enumEncoder(FILM_SIMULATION_VALUES),
    note: '富士フイルム独自。コード・値ともに実機で要検証。',
  },
  {
    field: 'dynamicRange',
    code: 0xd007,
    dataType: PtpDataType.UINT16,
    confidence: 'unverified',
    values: DYNAMIC_RANGE_VALUES,
    encode: enumEncoder(DYNAMIC_RANGE_VALUES),
    note: '富士フイルム独自。実機で要検証。',
  },
];

export interface PropertyOverride {
  code?: number;
  dataType?: number;
  confidence?: Confidence;
  values?: Record<string, number>;
  note?: string;
}

/**
 * JSON の上書き定義を既定表へ適用する。
 * 既定表に無いフィールドも、code と values があれば新規に追加できる。
 */
export function applyOverrides(
  bindings: readonly PropertyBinding[],
  overrides: Record<string, PropertyOverride>,
): PropertyBinding[] {
  const byField = new Map<string, PropertyBinding>(bindings.map((b) => [b.field, { ...b }]));

  for (const [field, override] of Object.entries(overrides)) {
    const existing = byField.get(field);
    const values = override.values ?? existing?.values;
    const merged: PropertyBinding = {
      field: field as keyof ShootingSettings,
      code: override.code ?? existing?.code ?? 0,
      dataType: (override.dataType ?? existing?.dataType ?? PtpDataType.UINT16) as PtpDataType,
      confidence: override.confidence ?? 'community',
      values,
      encode: values ? enumEncoder(values) : (existing?.encode ?? (() => null)),
      note: override.note ?? existing?.note,
    };
    if (merged.code === 0) continue; // コード不明のものは無効
    byField.set(field, merged);
  }

  return [...byField.values()];
}

export function bindingsByField(
  bindings: readonly PropertyBinding[],
): Map<keyof ShootingSettings, PropertyBinding> {
  return new Map(bindings.map((b) => [b.field, b]));
}
