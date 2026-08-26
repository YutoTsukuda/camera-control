/**
 * gphoto2 CLI の出力パーサ。
 *
 * 出力書式は推測ではなく、gphoto2 バイナリの書式文字列から確定させたもの:
 *
 *   <設定パス>            ← 行頭が / で始まる
 *   Label: %s
 *   Readonly: %d
 *   Type: TEXT|RANGE|TOGGLE|DATE|MENU|RADIO
 *   Current: %s           ← TEXT/MENU/RADIO
 *   Current: %g           ← RANGE
 *   Current: %d           ← TOGGLE/DATE
 *   Bottom: %g / Top: %g / Step: %g   ← RANGE のみ
 *   Choice: %d %s         ← MENU/RADIO のみ、選択肢の数だけ繰り返し
 *
 * 注意: gphoto2 2.5.28 は項目末尾に END を出力しない（バイナリに文字列が存在しない）。
 * 新しめの版は END を出すため、パーサは「次のパス行」と「END 行」の両方を
 * 項目の区切りとして扱う。版差でここが壊れると全機能が死ぬので、
 * テストで両方の書式を固定している。
 */

export type WidgetType = 'TEXT' | 'RANGE' | 'TOGGLE' | 'DATE' | 'MENU' | 'RADIO' | 'SECTION';

export interface ConfigChoice {
  index: number;
  value: string;
}

export interface ConfigEntry {
  /** 例: /main/capturesettings/f-number */
  path: string;
  /** パスの末尾。マッピングの照合はここで行う。 */
  name: string;
  label: string;
  readonly: boolean;
  type: WidgetType;
  current: string;
  choices: ConfigChoice[];
  range?: { bottom: number; top: number; step: number };
}

/** `gphoto2 --list-all-config` の出力を解析する。 */
export function parseConfigList(output: string): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  let current: ConfigEntry | undefined;

  const flush = () => {
    if (current) entries.push(current);
    current = undefined;
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line === 'END') {
      flush();
      continue;
    }

    if (line.startsWith('/')) {
      flush();
      const path = line.trim();
      current = {
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        label: '',
        readonly: false,
        type: 'TEXT',
        current: '',
        choices: [],
      };
      continue;
    }

    if (!current) continue;

    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    switch (key) {
      case 'Label':
        current.label = value;
        break;
      case 'Readonly':
        current.readonly = value !== '0';
        break;
      case 'Type':
        current.type = value as WidgetType;
        break;
      case 'Current':
        current.current = value;
        break;
      case 'Choice': {
        // "Choice: 3 Classic Chrome" → index=3, value="Classic Chrome"
        const match = /^(\d+)\s?(.*)$/s.exec(value);
        if (match) {
          current.choices.push({ index: Number(match[1]), value: (match[2] ?? '').trim() });
        }
        break;
      }
      case 'Bottom':
      case 'Top':
      case 'Step': {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) break;
        current.range ??= { bottom: 0, top: 0, step: 1 };
        if (key === 'Bottom') current.range.bottom = numeric;
        else if (key === 'Top') current.range.top = numeric;
        else current.range.step = numeric;
        break;
      }
      default:
        break;
    }
  }

  flush();
  return entries;
}

export interface DetectedCamera {
  model: string;
  port: string;
}

/**
 * `gphoto2 --auto-detect` の出力を解析する。
 * 書式は "%-30s %-16s" だが、機種名が30文字を超えると桁が崩れるため
 * 「末尾の usb:... を port、その手前を model」として読む。
 */
export function parseAutoDetect(output: string): DetectedCamera[] {
  const cameras: DetectedCamera[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^-+$/.test(line) || /^Model\s+Port$/i.test(line)) continue;
    const match = /^(.*?)\s{2,}((?:usb|ptpip|serial|disk|ptpip)[^\s]*)$/i.exec(line);
    if (match) {
      cameras.push({ model: (match[1] ?? '').trim(), port: (match[2] ?? '').trim() });
    }
  }
  return cameras;
}

// --- 選択肢の文字列 → 数値 -------------------------------------------------
// カメラが返す表記はドライバや機種で揺れるため、いずれも複数書式を受ける。

/** "f/2.8" / "2.8" / "F2.8" → 2.8 */
export function parseAperture(value: string): number | undefined {
  const match = /(\d+(?:\.\d+)?)/.exec(value.replace(/^f\/?/i, ''));
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** "1/250" / "0.004" / "2" / "2.5s" / "30" → 秒 */
export function parseShutterSeconds(value: string): number | undefined {
  const text = value.trim().replace(/s(ec)?$/i, '').replace(/"$/, '');
  if (/^bulb$/i.test(text) || /^auto$/i.test(text)) return undefined;

  const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator > 0) return numerator / denominator;
    return undefined;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** "400" / "ISO 400" / "Auto" → 400 | 'AUTO' */
export function parseIso(value: string): number | 'AUTO' | undefined {
  if (/auto/i.test(value)) return 'AUTO';
  const match = /(\d+)/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** "+1/3" / "-2" / "0.333" / "+0.3" → EV 値 */
export function parseExposureCompensation(value: string): number | undefined {
  const text = value.trim();
  const fraction = /^([+-]?)(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction) {
    const sign = fraction[1] === '-' ? -1 : 1;
    const denominator = Number(fraction[3]);
    if (denominator === 0) return undefined;
    return (sign * Number(fraction[2])) / denominator;
  }
  const parsed = Number(text.replace(/^\+/, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 照合用の正規化: 小文字化し、英数字以外を削る。 */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
