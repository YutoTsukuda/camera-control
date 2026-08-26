/**
 * Claude に返させる構造化出力のスキーマ。
 *
 * 設計方針:
 *
 * 1. AI に露出三角の最終値を直接決めさせない。
 *    AI が担うのは「シーンの読み取り」と「どの軸を優先するか（= exposurePlan）」、
 *    および数値計算では決められない絵作り（フィルムシミュレーション等）。
 *    実際の F値/SS/ISO は決定論的なソルバ（domain/exposure.ts）が確定させる。
 *
 * 2. 1 項目の逸脱で提案全体を捨てない。
 *    構造化出力の JSON Schema からは enum や min/max が落ちて説明文に畳み込まれる
 *    （SDK が API のスキーマ・サブセットに合わせるため）ので、モデルが語彙外の値を
 *    返す可能性は残る。そこを厳密にすると 1 文字の違いでルールベースへ全面フォールバック
 *    してしまうため、enum と範囲付き数値は `.catch()` で安全な既定値へ落とす。
 */
import * as z from 'zod/v4';

/** 語彙外の値が来たら既定値へ落ちる列挙。説明文は enum とともにモデルへ渡る。 */
function safeEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
  description: string,
) {
  return z.enum(values).describe(description).catch(fallback as never);
}

/** 範囲外・型違いが来たら既定値へ落ちる数値。実際の丸めは domain/validate.ts が行う。 */
function safeNumber(description: string, fallback: number, range?: { min: number; max: number }) {
  const base = range
    ? z.number().min(range.min).max(range.max)
    : z.number();
  return base.describe(description).catch(fallback);
}

const filmSimulation = safeEnum(
  [
    'PROVIA_STD', 'VELVIA_VIVID', 'ASTIA_SOFT', 'CLASSIC_CHROME', 'PRO_NEG_HI',
    'PRO_NEG_STD', 'CLASSIC_NEG', 'NOSTALGIC_NEG', 'ETERNA_CINEMA',
    'ETERNA_BLEACH_BYPASS', 'REALA_ACE', 'ACROS', 'ACROS_YE', 'ACROS_R',
    'ACROS_G', 'MONOCHROME', 'MONOCHROME_YE', 'MONOCHROME_R', 'MONOCHROME_G',
    'SEPIA',
  ],
  'PROVIA_STD',
  'フィルムシミュレーション。シーンと意図に最も合うものを選ぶ。',
);

const whiteBalance = safeEnum(
  [
    'AUTO', 'AUTO_WHITE_PRIORITY', 'AUTO_AMBIENCE_PRIORITY', 'DAYLIGHT', 'SHADE',
    'FLUORESCENT_1', 'FLUORESCENT_2', 'FLUORESCENT_3', 'INCANDESCENT',
    'UNDERWATER', 'KELVIN', 'CUSTOM_1', 'CUSTOM_2', 'CUSTOM_3',
  ],
  'AUTO',
  'ホワイトバランス。光源が明確なら固定、混合光ならAUTO。雰囲気を残すならAUTO（雰囲気優先）。',
);

const colorChromeOff = (description: string) =>
  safeEnum(['OFF', 'WEAK', 'STRONG'], 'OFF', description);

export const AdviceSchema = z.object({
  sceneAnalysis: z
    .string()
    .describe('写真から読み取ったシーンの説明。日本語1〜2文。光の向き・質・被写体・想定される難所を述べる。')
    .catch('シーンの読み取りに失敗しました。'),

  sceneEv100: safeNumber(
    'シーンの明るさを ISO100 換算の EV で推定した値。快晴の直射日光=15、曇り=12、明るい室内=8、一般的な室内照明=6、夜の繁華街=4。測光値が入力で与えられている場合は必ずその値をそのまま返すこと。',
    12,
    { min: -6, max: 20 },
  ),

  backlit: z.boolean().describe('主要被写体が逆光かどうか。').catch(false),

  contrast: safeNumber(
    '輝度差の厳しさ。0=平坦、1=白飛びと黒潰れが同時に起きる状況。',
    0.4,
    { min: 0, max: 1 },
  ),

  exposureMode: safeEnum(
    ['P', 'A', 'S', 'M'],
    'A',
    '露出モード。基本は絞り優先(A)。動きを止める意図が主なら S、光が一定で追い込むなら M。',
  ),

  exposurePlan: z
    .object({
      preferredAperture: safeNumber(
        '絵作り上の希望F値。2〜16。ボケ重視なら2〜2.8、風景の全域シャープなら5.6〜8。回折で解像が落ちるためF11以上は必要な時だけ。',
        5.6,
        { min: 2, max: 16 },
      ),
      slowestShutterSec: safeNumber(
        '許容できる最も遅いシャッター速度[秒]。被写体ブレの許容度で決める。静物の手持ち=0.125、歩く人=1/125、走る子どもやスポーツ=1/500。',
        1 / 125,
        { min: 1 / 8000, max: 30 },
      ),
      maxIso: safeNumber(
        '許容するISO上限。画質優先なら3200、暗所で写ることを優先するなら12800。',
        6400,
        { min: 125, max: 12800 },
      ),
      exposureCompensation: safeNumber(
        '露出補正[EV]。-5〜+5。逆光の人物は+0.7〜+1.7、白い被写体は+、黒い被写体やネオンの締めは-。',
        0,
        { min: -5, max: 5 },
      ),
      preferredShutterType: safeEnum(
        ['MS', 'ES', 'MS+ES'],
        'MS',
        'シャッター方式。基本はMS（メカニカル）。静粛性が要るならES。ESは動体で歪み、蛍光灯下で縞が出る。',
      ),
      allowNd: z
        .boolean()
        .describe('内蔵ND（4段）の使用可否。日中に開放でボケを出したい場合は true。')
        .catch(true),
      allowStopDown: z
        .boolean()
        .describe('露出を合わせるために希望F値から絞り込んでよいか。ボケが主目的なら false。')
        .catch(true),
    })
    .describe('露出の方針。実際のF値/SS/ISOはこの方針からシステムが算出する。'),

  look: z
    .object({
      filmSimulation,
      whiteBalance,
      whiteBalanceKelvin: z
        .number()
        .nullable()
        .describe('whiteBalance が KELVIN のときの色温度[K]。2500〜10000。それ以外は null。')
        .catch(null),
      wbShiftRed: safeNumber(
        'WBシフト赤軸。-9〜+9。プラスで赤方向、マイナスでシアン方向。夕景の赤みを強調するなら+2〜+4、曇天や日陰の青かぶりを戻すなら+1〜+2。確信が無ければ0。',
        0,
        { min: -9, max: 9 },
      ),
      wbShiftBlue: safeNumber(
        'WBシフト青軸。-9〜+9。プラスで青方向、マイナスで黄方向。赤軸と組み合わせると斜め方向になり、両方プラスでマゼンタ方向（緑かぶりの打ち消し）、両方マイナスでグリーン方向。確信が無ければ0。',
        0,
        { min: -9, max: 9 },
      ),
      dynamicRange: safeEnum(
        ['DR100', 'DR200', 'DR400', 'DR_AUTO'],
        'DR_AUTO',
        'ダイナミックレンジ。DR200はISO250以上、DR400はISO500以上が必要。',
      ),
      highlightTone: safeNumber(
        'ハイライトトーン -2〜+4（0.5刻み）。マイナスが軟調でハイライトを粘らせる（雪・白い壁・逆光の空）、プラスが硬調で明部を締める。±1〜2 に収めるのが基本。',
        0,
        { min: -2, max: 4 },
      ),
      shadowTone: safeNumber(
        'シャドウトーン -2〜+4（0.5刻み）。マイナスが軟調で暗部を持ち上げる（逆光の人物・日陰・室内）、プラスが硬調で黒を締める（夜景・モノクロ）。±1〜2 に収めるのが基本。',
        0,
        { min: -2, max: 4 },
      ),
      color: safeNumber('カラー（彩度） -4〜+4。モノクロ系では無視される。', 0, { min: -4, max: 4 }),
      sharpness: safeNumber('シャープネス -4〜+4。', 0, { min: -4, max: 4 }),
      noiseReduction: safeNumber(
        'ノイズリダクション -4〜+4。高感度でもディテール優先なら-2程度。',
        0,
        { min: -4, max: 4 },
      ),
      clarity: safeNumber(
        'クラリティ -5〜+5。人物はマイナス、風景はプラスが効きやすい。',
        0,
        { min: -5, max: 5 },
      ),
      grainEffect: safeEnum(
        ['OFF', 'WEAK_SMALL', 'WEAK_LARGE', 'STRONG_SMALL', 'STRONG_LARGE'],
        'OFF',
        'グレイン・エフェクト。フィルム感を足したいときのみ。',
      ),
      colorChromeEffect: colorChromeOff('カラークロームエフェクト。濃い色の階調を残す。赤や花に有効。'),
      colorChromeFxBlue: colorChromeOff('カラークロームブルー。青の階調を残す。空や水に有効。'),
    })
    .describe('絵作りの設定。ここが AI の主戦場。'),

  operation: z
    .object({
      meteringMode: safeEnum(
        ['MULTI', 'CENTER_WEIGHTED', 'SPOT', 'AVERAGE'],
        'MULTI',
        '測光モード。逆光の人物を主題にするならスポットが効く。',
      ),
      focusMode: safeEnum(
        ['AF_S', 'AF_C', 'MF'],
        'AF_S',
        'フォーカスモード。動く被写体は AF-C。',
      ),
      afArea: safeEnum(
        ['SINGLE_POINT', 'ZONE', 'WIDE_TRACKING'],
        'SINGLE_POINT',
        'AFエリア。動体はワイド/トラッキング。',
      ),
      subjectDetection: safeEnum(
        ['OFF', 'FACE_EYE', 'ANIMAL', 'BIRD', 'CAR', 'BIKE', 'AIRPLANE', 'TRAIN'],
        'OFF',
        '被写体検出。人物なら顔・瞳。',
      ),
      driveMode: safeEnum(
        ['SINGLE', 'CONTINUOUS_LOW', 'CONTINUOUS_HIGH', 'BRACKET_AE', 'HDR'],
        'SINGLE',
        'ドライブモード。決定的瞬間を追うなら連写。',
      ),
      imageQuality: safeEnum(
        ['FINE', 'NORMAL', 'FINE_RAW', 'NORMAL_RAW', 'RAW'],
        'FINE',
        '画質モード。後から追い込むなら RAW 併用。',
      ),
      digitalTeleconverter: safeEnum(
        ['OFF', 'X1_4', 'X2_0'],
        'OFF',
        'デジタルテレコン。35mm相当では寄れないときのみ。JPEG専用。',
      ),
    })
    .describe('撮影操作系の設定。'),

  rationale: z
    .string()
    .describe('提案の理由。日本語で2〜4文。なぜこの絞り・この方式・このフィルムシミュレーションなのかを、撮影者に伝わる言葉で書く。')
    .catch(''),

  warnings: z
    .array(z.string())
    .describe('撮影時に注意すべき点。日本語。無ければ空配列。')
    .catch([]),

  confidence: safeNumber(
    '提案全体の確信度。0〜1。写真が無い/暗すぎて判断できない場合は低くする。',
    0.5,
    { min: 0, max: 1 },
  ),
});

export type Advice = z.infer<typeof AdviceSchema>;
