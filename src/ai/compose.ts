/**
 * Advice（AI or ルール）→ カメラへ書ける ShootingSettings への変換。
 *
 * ここが「AI の判断」と「決定論的な計算」の合流点。
 *   Advice.exposurePlan → 露出ソルバ → 具体的な F値/SS/ISO/ND
 *   Advice.look / operation → そのまま設定へ
 *   → 最後にバリデータで機種制約を解いて確定
 */
import { solveExposure } from '../domain/exposure.js';
import { validateSettings } from '../domain/validate.js';
import type { Correction, SettingsProposal, ShootingSettings } from '../domain/types.js';
import type { Advice } from './schema.js';
import type { AdvisorInput } from './prompt.js';

/**
 * 絞り優先などの自動露出モードでは、ISO とシャッター速度をカメラに任せる。
 * その場合でも「暗くなったら勝手に 1/8 秒まで落ちてブレる」ことがないよう、
 * ISO AUTO の上限と低速限界をソルバの方針から明示的に書き込む。
 */
const AUTO_EXPOSURE_MODES = new Set(['P', 'A', 'S']);

export function composeProposal(
  advice: Advice,
  input: AdvisorInput,
  source: SettingsProposal['source'],
): SettingsProposal {
  // 実測の測光値があれば AI の推定より常に優先する。
  const sceneEv100 = input.scene?.ev100 ?? advice.sceneEv100;

  const solution = solveExposure({
    sceneEv100,
    preferredAperture: advice.exposurePlan.preferredAperture,
    slowestShutterSec: advice.exposurePlan.slowestShutterSec,
    maxIso: advice.exposurePlan.maxIso,
    exposureCompensation: advice.exposurePlan.exposureCompensation,
    preferredShutterType: advice.exposurePlan.preferredShutterType,
    allowNd: advice.exposurePlan.allowNd,
    allowStopDown: advice.exposurePlan.allowStopDown,
  });

  const isAuto = AUTO_EXPOSURE_MODES.has(advice.exposureMode);

  const draft: ShootingSettings = {
    exposureMode: advice.exposureMode,
    aperture: solution.aperture,
    shutterSpeedSec: solution.shutterSpeedSec,
    iso: isAuto ? 'AUTO' : solution.iso,
    exposureCompensation: solution.exposureCompensation,
    shutterType: solution.shutterType,
    ndFilter: solution.ndFilter,

    filmSimulation: advice.look.filmSimulation,
    whiteBalance: advice.look.whiteBalance,
    wbShiftRed: advice.look.wbShiftRed,
    wbShiftBlue: advice.look.wbShiftBlue,
    dynamicRange: advice.look.dynamicRange,
    highlightTone: advice.look.highlightTone,
    shadowTone: advice.look.shadowTone,
    color: advice.look.color,
    sharpness: advice.look.sharpness,
    noiseReduction: advice.look.noiseReduction,
    clarity: advice.look.clarity,
    grainEffect: advice.look.grainEffect,
    colorChromeEffect: advice.look.colorChromeEffect,
    colorChromeFxBlue: advice.look.colorChromeFxBlue,

    meteringMode: advice.operation.meteringMode,
    focusMode: advice.operation.focusMode,
    afArea: advice.operation.afArea,
    subjectDetection: advice.operation.subjectDetection,
    driveMode: advice.operation.driveMode,
    imageQuality: advice.operation.imageQuality,
    digitalTeleconverter: advice.operation.digitalTeleconverter,
  };

  if (advice.look.whiteBalanceKelvin !== null) {
    draft.whiteBalanceKelvin = advice.look.whiteBalanceKelvin;
  }

  if (isAuto) {
    draft.isoAutoMax = advice.exposurePlan.maxIso;
    draft.isoAutoMinShutterSec = advice.exposurePlan.slowestShutterSec;
  }

  const validated = validateSettings(draft);
  const corrections: Correction[] = [...solution.corrections, ...validated.corrections];

  // 露出が大きく外れる（=どうやっても合わない）場合は確信度を下げる。
  const exposurePenalty = Math.min(0.4, Math.abs(solution.errorEv) * 0.15);
  const confidence = Math.max(0, Math.min(1, advice.confidence - exposurePenalty));

  return {
    settings: validated.settings,
    rationale: advice.rationale,
    confidence,
    source,
    corrections,
    resolvedEv100: solution.resolvedEv100,
    predictedExposure: {
      aperture: solution.aperture,
      shutterSpeedSec: solution.shutterSpeedSec,
      iso: solution.iso,
      ndFilter: solution.ndFilter,
    },
    warnings: advice.warnings,
    sceneAnalysis: advice.sceneAnalysis,
  };
}
