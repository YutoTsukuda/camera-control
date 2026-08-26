/**
 * シーン輝度（EV100）の参照テーブルと推定ロジック。
 *
 * カメラが接続されていれば実測の測光値を使うが、写真だけを見て
 * 提案する場合や接続前のプリセット生成では、この表が拠り所になる。
 * 値は一般的な露出表（Sunny 16 系）に基づく代表値。
 */
export interface SceneReference {
  key: string;
  labelJa: string;
  ev100: number;
}

export const SCENE_TABLE: readonly SceneReference[] = [
  { key: 'SNOW_BEACH_SUN', labelJa: '晴天の雪山・砂浜', ev100: 16 },
  { key: 'BRIGHT_SUN', labelJa: '快晴の屋外（直射日光）', ev100: 15 },
  { key: 'HAZY_SUN', labelJa: '薄曇りの屋外', ev100: 14 },
  { key: 'OVERCAST', labelJa: '曇りの屋外', ev100: 12 },
  { key: 'OPEN_SHADE', labelJa: '晴天の日陰', ev100: 12 },
  { key: 'HEAVY_OVERCAST', labelJa: '厚い雲・雨天', ev100: 11 },
  { key: 'SUNSET', labelJa: '日没直後・マジックアワー', ev100: 9 },
  { key: 'BRIGHT_INDOOR', labelJa: '明るい屋内（窓際・店舗）', ev100: 8 },
  { key: 'INDOOR', labelJa: '一般的な屋内照明', ev100: 6 },
  { key: 'DIM_INDOOR', labelJa: '薄暗い屋内・レストラン', ev100: 5 },
  { key: 'NIGHT_STREET', labelJa: '夜の繁華街・ネオン', ev100: 4 },
  { key: 'NIGHT_CITY', labelJa: '夜景（街明かり）', ev100: 3 },
  { key: 'CANDLE', labelJa: 'ろうそく・キャンドル', ev100: 3 },
  { key: 'MOONLIT', labelJa: '満月の夜景', ev100: -2 },
];

const BY_KEY = new Map(SCENE_TABLE.map((s) => [s.key, s]));

export function sceneEv(key: string): number | undefined {
  return BY_KEY.get(key)?.ev100;
}

/**
 * ISO100 換算 EV から、最も近いシーン名を返す。UI の説明表示に使う。
 */
export function describeEv(ev100: number): string {
  let best = SCENE_TABLE[0] as SceneReference;
  let bestDist = Infinity;
  for (const scene of SCENE_TABLE) {
    const dist = Math.abs(scene.ev100 - ev100);
    if (dist < bestDist) {
      bestDist = dist;
      best = scene;
    }
  }
  return `EV ${ev100.toFixed(1)}（${best.labelJa}相当）`;
}

/**
 * カメラの実測値がない場合の保守的な既定値。
 * 「屋内でいきなり ISO12800 を提案してしまう」より
 * 「曇天と仮定して外す」ほうが被害が小さいので、中庸の 12 を採る。
 */
export const DEFAULT_EV100 = 12;
