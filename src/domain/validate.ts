/**
 * 設定バリデータ（ガードレール層）。
 *
 * AI が返した設定でも、UI が組み立てた設定でも、カメラへ送る前に必ずここを通す。
 * 目的は 3 つ:
 *   1. 選べない値を、選べる値に丸める（1/3段ラダー、範囲クランプ）
 *   2. 機種固有の排他・依存関係を解く（DRとISO、モノクロと彩度、RAWとデジタルテレコン…）
 *   3. 何をなぜ変えたかを日本語で記録し、UI でユーザーに見せる
 */
import {
  APERTURES,
  DR_MIN_ISO,
  EXPOSURE_COMPENSATION_RANGE,
  ISO_ALL,
  ISO_NATIVE,
  KELVIN_RANGE,
  MONOCHROME_SIMULATIONS,
  RAW_QUALITIES,
  SHUTTER_SPEEDS,
  SLOWEST_SHUTTER_SEC,
  TONE_RANGES,
  fastestShutterSec,
  mechanicalFastestSec,
} from './capabilities.js';
import { formatShutter, snapExposureCompensation, snapLog, snapUp } from './exposure.js';
import type { Correction, ShootingSettings } from './types.js';

export interface ValidationResult {
  settings: ShootingSettings;
  corrections: Correction[];
}

function clampToRange(
  value: number,
  range: { min: number; max: number; step: number },
): number {
  const stepped = Math.round(value / range.step) * range.step;
  const clamped = Math.min(range.max, Math.max(range.min, stepped));
  // 0.5 刻みなどで浮動小数の誤差が出るため丸め直す
  return Math.round(clamped * 1000) / 1000;
}

/**
 * 設定一式を検証し、カメラに書ける形へ正規化する。
 * 入力は破壊しない。
 */
export function validateSettings(input: ShootingSettings): ValidationResult {
  const s: ShootingSettings = { ...input };
  const corrections: Correction[] = [];

  const note = (
    field: Correction['field'],
    from: unknown,
    to: unknown,
    reason: string,
    severity: Correction['severity'] = 'info',
  ) => {
    corrections.push({ field, from, to, reason, severity });
  };

  // --- 絞り ---
  if (s.aperture !== undefined) {
    const snapped = snapLog(s.aperture, APERTURES);
    if (Math.abs(snapped - s.aperture) > 1e-6) {
      note('aperture', s.aperture, snapped, `F${s.aperture} は選択できないため F${snapped} に丸めました。`);
      s.aperture = snapped;
    }
  }

  // --- ISO ---
  if (typeof s.iso === 'number') {
    const snapped = snapLog(s.iso, ISO_ALL);
    if (snapped !== s.iso) {
      note('iso', s.iso, snapped, `ISO ${s.iso} は設定できないため ISO ${snapped} に丸めました。`);
      s.iso = snapped;
    }
  }
  if (s.isoAutoMax !== undefined) {
    const snapped = snapLog(s.isoAutoMax, ISO_NATIVE);
    if (snapped !== s.isoAutoMax) {
      note('isoAutoMax', s.isoAutoMax, snapped, `ISO AUTO の上限を ISO ${snapped} に丸めました。`);
      s.isoAutoMax = snapped;
    }
  }

  // --- シャッター速度 ---
  if (s.shutterSpeedSec !== undefined) {
    const snapped = snapLog(s.shutterSpeedSec, SHUTTER_SPEEDS);
    if (Math.abs(snapped - s.shutterSpeedSec) > 1e-9) {
      note(
        'shutterSpeedSec',
        formatShutter(s.shutterSpeedSec),
        formatShutter(snapped),
        `${formatShutter(s.shutterSpeedSec)} は選択できないため ${formatShutter(snapped)} に丸めました。`,
      );
      s.shutterSpeedSec = snapped;
    }
    if (s.shutterSpeedSec > SLOWEST_SHUTTER_SEC) {
      note(
        'shutterSpeedSec',
        formatShutter(s.shutterSpeedSec),
        formatShutter(SLOWEST_SHUTTER_SEC),
        '通常撮影の最長は30秒です。それ以上はバルブ（B）撮影が必要です。',
        'warn',
      );
      s.shutterSpeedSec = SLOWEST_SHUTTER_SEC;
    }
  }

  if (s.isoAutoMinShutterSec !== undefined) {
    const snapped = snapLog(s.isoAutoMinShutterSec, SHUTTER_SPEEDS);
    if (Math.abs(snapped - s.isoAutoMinShutterSec) > 1e-9) {
      note(
        'isoAutoMinShutterSec',
        formatShutter(s.isoAutoMinShutterSec),
        formatShutter(snapped),
        `ISO AUTO の低速限界を ${formatShutter(snapped)} に丸めました。`,
      );
      s.isoAutoMinShutterSec = snapped;
    }
  }

  // --- リーフシャッターの絞り依存上限 ---
  // X100VI で最も引っかかりやすい制約。ここで必ず捕まえる。
  if (s.shutterSpeedSec !== undefined && s.aperture !== undefined) {
    const type = s.shutterType ?? 'MS';
    const fastest = fastestShutterSec(type, s.aperture);
    if (s.shutterSpeedSec < fastest - 1e-12) {
      if (type === 'MS') {
        const mech = mechanicalFastestSec(s.aperture);
        note(
          'shutterType',
          'MS',
          'MS+ES',
          `F${s.aperture} のメカニカルシャッター上限は ${formatShutter(mech)} です。${formatShutter(s.shutterSpeedSec)} を実現するため電子シャッター併用（MS+ES）に変更しました。`,
          'warn',
        );
        s.shutterType = 'MS+ES';
      } else {
        note(
          'shutterSpeedSec',
          formatShutter(s.shutterSpeedSec),
          formatShutter(fastest),
          `${formatShutter(fastest)} より速いシャッターは切れないため上限に合わせました。`,
          'warn',
        );
        s.shutterSpeedSec = fastest;
      }
    }
  }

  // --- 露出補正 ---
  if (s.exposureCompensation !== undefined) {
    const snapped = snapExposureCompensation(s.exposureCompensation);
    const clamped = Math.min(
      EXPOSURE_COMPENSATION_RANGE.max,
      Math.max(EXPOSURE_COMPENSATION_RANGE.min, snapped),
    );
    if (Math.abs(clamped - s.exposureCompensation) > 1e-6) {
      note(
        'exposureCompensation',
        s.exposureCompensation,
        clamped,
        `露出補正は ±5EV・1/3段刻みのため ${clamped > 0 ? '+' : ''}${clamped.toFixed(2)}EV に丸めました。`,
      );
    }
    s.exposureCompensation = clamped;
  }

  // --- 露出モードとの整合 ---
  // 以下 2 件は値を変更しない補足なので severity は 'note'。
  // 値を変えないため、再検証しても結果が変わらない（冪等性を壊さない）。
  if (s.exposureMode === 'A' && s.shutterSpeedSec !== undefined) {
    note(
      'shutterSpeedSec',
      formatShutter(s.shutterSpeedSec),
      'カメラが自動決定',
      '絞り優先(A)ではシャッター速度はカメラが決めます。提案値は目安として表示しています。',
      'note',
    );
  }
  if (s.exposureMode === 'S' && s.aperture !== undefined) {
    note(
      'aperture',
      s.aperture,
      'カメラが自動決定',
      'シャッター優先(S)では絞りはカメラが決めます。',
      'note',
    );
  }

  // --- ダイナミックレンジと ISO の依存関係 ---
  if (s.dynamicRange && s.dynamicRange !== 'DR_AUTO') {
    const minIso = DR_MIN_ISO[s.dynamicRange];
    const currentIso = typeof s.iso === 'number' ? s.iso : undefined;
    if (currentIso !== undefined && currentIso < minIso) {
      const raised = snapUp(minIso, ISO_NATIVE);
      note(
        'iso',
        currentIso,
        raised,
        `${s.dynamicRange} は ISO ${minIso} 以上でのみ選択できるため、ISO を ${raised} に上げました。`,
        'warn',
      );
      s.iso = raised;
    } else if (currentIso === undefined && s.isoAutoMax !== undefined && s.isoAutoMax < minIso) {
      note(
        'dynamicRange',
        s.dynamicRange,
        'DR100',
        `ISO AUTO の上限が ${s.isoAutoMax} のため ${s.dynamicRange} を維持できません。DR100 に変更しました。`,
        'warn',
      );
      s.dynamicRange = 'DR100';
    }
  }

  // --- Dレンジ優先とトーンカーブの排他 ---
  if (s.dRangePriority && s.dRangePriority !== 'OFF') {
    if (s.dynamicRange !== undefined) {
      note(
        'dynamicRange',
        s.dynamicRange,
        undefined,
        'Dレンジ優先が有効なとき、ダイナミックレンジ設定はカメラが自動制御するため送信しません。',
      );
      delete s.dynamicRange;
    }
    for (const field of ['highlightTone', 'shadowTone'] as const) {
      if (s[field] !== undefined) {
        note(
          field,
          s[field],
          undefined,
          'Dレンジ優先が有効なとき、ハイライト/シャドウトーンは変更できません。',
        );
        delete s[field];
      }
    }
  }

  // --- モノクロ系フィルムシミュレーションと彩度の排他 ---
  if (s.filmSimulation && MONOCHROME_SIMULATIONS.includes(s.filmSimulation)) {
    if (s.color !== undefined) {
      note('color', s.color, undefined, 'モノクロ系フィルムシミュレーションではカラー（彩度）調整は効きません。');
      delete s.color;
    }
    if (s.colorChromeEffect !== undefined && s.colorChromeEffect !== 'OFF') {
      note(
        'colorChromeEffect',
        s.colorChromeEffect,
        'OFF',
        'モノクロ系ではカラークロームエフェクトは効きません。',
      );
      s.colorChromeEffect = 'OFF';
    }
  }

  // --- ホワイトバランス ---
  if (s.whiteBalance === 'KELVIN') {
    const k = s.whiteBalanceKelvin ?? 5500;
    const clamped = Math.min(KELVIN_RANGE.max, Math.max(KELVIN_RANGE.min, Math.round(k / 100) * 100));
    if (clamped !== s.whiteBalanceKelvin) {
      note(
        'whiteBalanceKelvin',
        s.whiteBalanceKelvin,
        clamped,
        `色温度は ${KELVIN_RANGE.min}K〜${KELVIN_RANGE.max}K の範囲に丸めました。`,
      );
    }
    s.whiteBalanceKelvin = clamped;
  } else if (s.whiteBalanceKelvin !== undefined) {
    note(
      'whiteBalanceKelvin',
      s.whiteBalanceKelvin,
      undefined,
      'ホワイトバランスが色温度指定ではないため、ケルビン値は送信しません。',
    );
    delete s.whiteBalanceKelvin;
  }
  for (const field of ['wbShiftRed', 'wbShiftBlue'] as const) {
    const v = s[field];
    if (v !== undefined) {
      const clamped = Math.max(-9, Math.min(9, Math.round(v)));
      if (clamped !== v) {
        note(field, v, clamped, 'WBシフトは -9〜+9 の範囲です。');
        s[field] = clamped;
      }
    }
  }

  // --- 画質調整パラメータの範囲 ---
  for (const field of Object.keys(TONE_RANGES) as (keyof typeof TONE_RANGES)[]) {
    const v = s[field];
    if (typeof v === 'number') {
      const clamped = clampToRange(v, TONE_RANGES[field]);
      if (Math.abs(clamped - v) > 1e-6) {
        const r = TONE_RANGES[field];
        note(field, v, clamped, `${field} は ${r.min}〜${r.max}（${r.step}刻み）の範囲に丸めました。`);
        s[field] = clamped;
      }
    }
  }

  // --- RAW とデジタルテレコンの排他 ---
  if (s.imageQuality && RAW_QUALITIES.includes(s.imageQuality)) {
    if (s.digitalTeleconverter && s.digitalTeleconverter !== 'OFF') {
      note(
        'digitalTeleconverter',
        s.digitalTeleconverter,
        'OFF',
        'デジタルテレコンは JPEG 専用のため、RAW 記録時は使用できません。',
        'warn',
      );
      s.digitalTeleconverter = 'OFF';
    }
    if (typeof s.iso === 'number' && (s.iso < 125 || s.iso > 12800)) {
      const clamped = s.iso < 125 ? 125 : 12800;
      note(
        'iso',
        s.iso,
        clamped,
        `拡張感度 ISO ${s.iso} は JPEG 専用です。RAW 記録のため常用域の ISO ${clamped} に変更しました。`,
        'warn',
      );
      s.iso = clamped;
    }
  }

  return { settings: s, corrections };
}
