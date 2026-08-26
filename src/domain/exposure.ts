/**
 * 露出計算エンジン。
 *
 * AI の提案は「絵作りの意図」には強いが、露出三角の整合や
 * リーフシャッターの絞り依存上限のような機構的制約を毎回正確に守るとは限らない。
 * そこで露出の最終決定はこの決定論的なソルバが担い、AI には
 * 「どの軸を優先するか」を決めてもらう、という責務分割にしている。
 */
import {
  APERTURES,
  FOCAL_LENGTH_EQUIV_MM,
  IBIS_EFFECTIVE_STOPS,
  ISO_NATIVE,
  ND_FILTER_STOPS,
  SHUTTER_SPEEDS,
  SLOWEST_SHUTTER_SEC,
  mechanicalFastestSec,
} from './capabilities.js';
import type { Correction, ShootingIntent, ShutterType } from './types.js';

/** 設定値そのものが通す光量を EV で表す（= log2(N²/t) - log2(S/100)）。 */
export function settingsEv(aperture: number, shutterSpeedSec: number, iso: number): number {
  return Math.log2((aperture * aperture) / shutterSpeedSec) - Math.log2(iso / 100);
}

/**
 * シーン輝度と補正から、設定側が満たすべき EV を求める。
 * 露出補正 +1EV は「1段明るく写す」＝設定側が 1 段多く光を通す、の意。
 */
export function requiredSettingsEv(
  sceneEv100: number,
  ndOn: boolean,
  exposureCompensation: number,
): number {
  return sceneEv100 - (ndOn ? ND_FILTER_STOPS : 0) - exposureCompensation;
}

/** 与えられた EV・絞り・ISO を満たすシャッター速度[秒]を求める。 */
export function shutterForEv(ev: number, aperture: number, iso: number): number {
  return (aperture * aperture) / (Math.pow(2, ev) * (iso / 100));
}

/** ラダー上で `value` に最も近い値を返す（対数距離で比較する）。 */
export function snapLog(value: number, ladder: readonly number[]): number {
  let best = ladder[0] ?? value;
  let bestDist = Infinity;
  for (const candidate of ladder) {
    const dist = Math.abs(Math.log2(candidate) - Math.log2(value));
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/** `value` 以下（=より遅い/暗い側）で最も近いラダー値。無ければ最小値。 */
export function snapDown(value: number, ladder: readonly number[]): number {
  const sorted = [...ladder].sort((a, b) => a - b);
  let best = sorted[0] as number;
  for (const candidate of sorted) {
    if (candidate <= value + 1e-12) best = candidate;
  }
  return best;
}

/** `value` 以上で最も近いラダー値。無ければ最大値。 */
export function snapUp(value: number, ladder: readonly number[]): number {
  const sorted = [...ladder].sort((a, b) => a - b);
  for (const candidate of sorted) {
    if (candidate >= value - 1e-12) return candidate;
  }
  return sorted[sorted.length - 1] as number;
}

/** シャッター速度を人間可読な表記に変換する（例: 0.004 → "1/250", 2 → "2\"" ）。 */
export function formatShutter(sec: number): string {
  if (sec >= 1) {
    const rounded = Math.round(sec * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}"`;
  }
  return `1/${Math.round(1 / sec)}`;
}

/** 露出補正を 1/3 段に丸める。 */
export function snapExposureCompensation(ev: number): number {
  return Math.round(ev * 3) / 3;
}

export interface HandheldFloorInput {
  /** 35mm判換算焦点距離。デジタルテレコン使用時は伸びる。 */
  equivFocalLengthMm?: number;
  support?: ShootingIntent['support'];
  motion?: ShootingIntent['motion'];
  /** IBIS を計算に入れるか（三脚時は無関係）。 */
  useIbis?: boolean;
}

/**
 * ブレを許容できる最も遅いシャッター速度[秒]を返す。
 *
 * 手持ちは「1/換算焦点距離」を基準に IBIS の実効段数だけ緩める。
 * 被写体が動いている場合は手ブレではなく被写体ブレが下限を支配する。
 */
export function handheldFloorSec(input: HandheldFloorInput = {}): number {
  const f = input.equivFocalLengthMm ?? FOCAL_LENGTH_EQUIV_MM;
  const motionFloor =
    input.motion === 'FAST' ? 1 / 500 : input.motion === 'SLOW' ? 1 / 125 : Infinity;

  if (input.support === 'TRIPOD') {
    return Math.min(SLOWEST_SHUTTER_SEC, motionFloor === Infinity ? SLOWEST_SHUTTER_SEC : motionFloor);
  }

  const base = 1 / f;
  const stabilized = input.useIbis === false ? base : base * Math.pow(2, IBIS_EFFECTIVE_STOPS);
  // IBIS を効かせても 1/4 秒より遅い手持ちは実用外とみなす
  const cameraShakeFloor = Math.min(stabilized, 0.25);
  return Math.min(cameraShakeFloor, motionFloor);
}

export interface ExposureSolveInput {
  /** ISO100 換算のシーン輝度 EV。 */
  sceneEv100: number;
  /** 絵作り上の希望絞り。ソルバはここから動かす場合、理由を corrections に残す。 */
  preferredAperture: number;
  /** 許容できる最も遅いシャッター速度[秒]。 */
  slowestShutterSec: number;
  /** ISO の上限。 */
  maxIso: number;
  /** ベースISO。既定 125。 */
  baseIso?: number;
  exposureCompensation?: number;
  /** 既定は 'MS'（メカニカル優先）。無音が必要なら 'ES'。 */
  preferredShutterType?: ShutterType;
  /** NDフィルターの使用可否。既定 true。 */
  allowNd?: boolean;
  /** 絞りを開ける方向に動かしてよいか（ボケ優先時は false にして開放を守る）。 */
  allowStopDown?: boolean;
}

export interface ExposureSolution {
  aperture: number;
  shutterSpeedSec: number;
  iso: number;
  ndFilter: 'ON' | 'OFF';
  shutterType: ShutterType;
  exposureCompensation: number;
  /** 実際に達成できた EV100 換算のシーン輝度。 */
  resolvedEv100: number;
  /** 目標露出とのズレ[EV]。0 に近いほど良い。 */
  errorEv: number;
  corrections: Correction[];
}

/**
 * シーン輝度・意図・機構制約から、実際にカメラへ書ける露出の組み合わせを解く。
 *
 * 優先順位は次の通り:
 *   1. 希望絞りを維持する（絵作りの根幹なので最後まで守る）
 *   2. ISO はベース感度に近いほど良い
 *   3. シャッター速度は手ブレ/被写体ブレ限界より速く
 *   4. 上記が両立しない明るさでは ND → 電子シャッター → 絞り込み の順で逃がす
 */
export function solveExposure(input: ExposureSolveInput): ExposureSolution {
  const corrections: Correction[] = [];
  const baseIso = input.baseIso ?? 125;
  const comp = snapExposureCompensation(input.exposureCompensation ?? 0);
  const allowNd = input.allowNd ?? true;
  const allowStopDown = input.allowStopDown ?? true;
  // 既定はメカニカル優先。X100VI のリーフシャッターは無音・無歪みで
  // フラッシュ全速同調も効くため、電子シャッターは最後の手段として扱う。
  const preferredShutterType = input.preferredShutterType ?? 'MS';

  let aperture = snapLog(input.preferredAperture, APERTURES);
  let iso = snapLog(baseIso, ISO_NATIVE);
  let ndOn = false;
  let shutterType: ShutterType = preferredShutterType;

  const isoLadder = ISO_NATIVE.filter((v) => v <= input.maxIso + 1e-9);
  const maxIsoAvailable = isoLadder[isoLadder.length - 1] ?? baseIso;

  /** 現在の絞り・方式で切れる最高速。 */
  const fastestFor = (ap: number, type: ShutterType): number =>
    type === 'MS' ? mechanicalFastestSec(ap) : 1 / 180000;

  // --- 1. ベースISO・希望絞りで必要なシャッター速度を求める ---
  let targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);

  // --- 2. 明るすぎる（シャッターが速すぎて切れない）場合 ---
  //     ND → 電子シャッター → 絞り込み の順に逃がす。
  const tooFast = () => targetShutter < fastestFor(aperture, shutterType) - 1e-12;

  if (tooFast() && allowNd) {
    ndOn = true;
    targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);
    corrections.push({
      field: 'ndFilter',
      from: 'OFF',
      to: 'ON',
      reason: `明るすぎて F${aperture} では ${formatShutter(fastestFor(aperture, shutterType))} でも露出オーバーになるため、内蔵ND（${ND_FILTER_STOPS}段）を使用します。`,
      severity: 'info',
    });
  }

  if (tooFast() && preferredShutterType === 'MS') {
    shutterType = 'MS+ES';
    corrections.push({
      field: 'shutterType',
      from: 'MS',
      to: 'MS+ES',
      reason: `リーフシャッターは F${aperture} だと ${formatShutter(mechanicalFastestSec(aperture))} が上限のため、電子シャッターへの自動切替を許可しました。`,
      severity: 'info',
    });
    targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);
  }

  while (tooFast() && allowStopDown) {
    const idx = APERTURES.indexOf(aperture);
    if (idx < 0 || idx >= APERTURES.length - 1) break;
    const next = APERTURES[idx + 1] as number;
    corrections.push({
      field: 'aperture',
      from: aperture,
      to: next,
      reason: `露出オーバーを避けるため F${aperture} から F${next} まで絞りました。`,
      severity: 'warn',
    });
    aperture = next;
    targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);
  }

  // --- 3. 暗すぎる（シャッターが遅すぎてブレる）場合: ISO を上げる ---
  if (targetShutter > input.slowestShutterSec + 1e-12) {
    const neededStops = Math.log2(targetShutter / input.slowestShutterSec);
    const wantIso = iso * Math.pow(2, neededStops);
    const nextIso = Math.min(snapUp(wantIso, isoLadder), maxIsoAvailable);
    if (nextIso > iso) {
      corrections.push({
        field: 'iso',
        from: iso,
        to: nextIso,
        reason: `${formatShutter(input.slowestShutterSec)} より遅いとブレるため、ISO を ${iso} から ${nextIso} に上げました。`,
        severity: 'info',
      });
      iso = nextIso;
      targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);
    }
  }

  // --- 4. まだ遅い場合: ND を外す → 絞りを開ける ---
  if (targetShutter > input.slowestShutterSec + 1e-12 && ndOn) {
    ndOn = false;
    corrections.push({
      field: 'ndFilter',
      from: 'ON',
      to: 'OFF',
      reason: 'シャッター速度を稼ぐため ND を解除しました。',
      severity: 'info',
    });
    targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);
  }

  while (targetShutter > input.slowestShutterSec + 1e-12) {
    const idx = APERTURES.indexOf(aperture);
    if (idx <= 0) break;
    const next = APERTURES[idx - 1] as number;
    corrections.push({
      field: 'aperture',
      from: aperture,
      to: next,
      reason: `シャッター速度を確保するため F${aperture} から F${next} まで開けました。`,
      severity: 'warn',
    });
    aperture = next;
    targetShutter = shutterForEv(requiredSettingsEv(input.sceneEv100, ndOn, comp), aperture, iso);
  }

  // --- 5. ラダーに丸め、機構上の上下限でクランプする ---
  const fastestSec = fastestFor(aperture, shutterType);
  const legal = SHUTTER_SPEEDS.filter((s) => s >= fastestSec - 1e-12 && s <= SLOWEST_SHUTTER_SEC);
  let shutter = snapLog(targetShutter, legal);

  if (targetShutter < fastestSec - 1e-12) {
    shutter = fastestSec;
    corrections.push({
      field: 'exposure',
      from: formatShutter(targetShutter),
      to: formatShutter(shutter),
      reason: `これ以上速いシャッターが切れないため露出オーバーになります。ND の追加やさらに絞ることを検討してください。`,
      severity: 'warn',
    });
  } else if (targetShutter > SLOWEST_SHUTTER_SEC) {
    shutter = SLOWEST_SHUTTER_SEC;
    corrections.push({
      field: 'exposure',
      from: formatShutter(targetShutter),
      to: formatShutter(shutter),
      reason: '30秒を超える露光が必要です。バルブ撮影か、より明るいレンズ条件が必要です。',
      severity: 'warn',
    });
  } else if (shutter > input.slowestShutterSec + 1e-12) {
    corrections.push({
      field: 'shutterSpeedSec',
      from: formatShutter(input.slowestShutterSec),
      to: formatShutter(shutter),
      reason: `ISO と絞りを使い切ってもブレ限界 ${formatShutter(input.slowestShutterSec)} を確保できませんでした。三脚の使用を推奨します。`,
      severity: 'warn',
    });
  }

  const achievedSettingsEv = settingsEv(aperture, shutter, iso);
  const resolvedEv100 = achievedSettingsEv + (ndOn ? ND_FILTER_STOPS : 0) + comp;
  const errorEv = resolvedEv100 - input.sceneEv100;

  return {
    aperture,
    shutterSpeedSec: shutter,
    iso,
    ndFilter: ndOn ? 'ON' : 'OFF',
    shutterType,
    exposureCompensation: comp,
    resolvedEv100,
    errorEv,
    corrections,
  };
}
