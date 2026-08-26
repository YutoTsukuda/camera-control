/**
 * 環境変数から読み込む実行時設定。
 * `.env.example` に一覧と既定値を載せてある。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** dist/src/config.js からプロジェクトルートを解決する。 */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

type Env = NodeJS.ProcessEnv;

function str(env: Env, name: string, fallback: string): string {
  const value = env[name];
  return value === undefined || value === '' ? fallback : value;
}

function num(env: Env, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export type TransportName = 'mock' | 'ptpip' | 'sdk-bridge';

export interface AppConfig {
  host: string;
  port: number;
  /** 設定した場合、API 呼び出しに X-Access-Token ヘッダ（または ?token=）が必要になる。 */
  accessToken?: string;

  camera: {
    transport: TransportName;
    host: string;
    port: number;
    /** 実際には送信せず、送るはずのフレームをログに出すだけのモード。 */
    dryRun: boolean;
    /** 実機未検証のプロパティも送信するか。 */
    allowUnverified: boolean;
    propertyOverridePath: string;
    sdkBridgeUrl: string;
    friendlyName: string;
  };

  ai: {
    model: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** true なら Claude を呼ばずルールベースのみを使う。 */
    offline: boolean;
    timeoutMs: number;
  };

  /** 提案を自動でカメラに書き込むエンドポイントを有効にするか。 */
  allowAutoApply: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const transport = str(env, 'CAMERA_TRANSPORT', 'mock') as TransportName;
  const accessToken = env.ACCESS_TOKEN;

  return {
    host: str(env, 'HOST', '0.0.0.0'),
    port: num(env, 'PORT', 8080),
    ...(accessToken ? { accessToken } : {}),

    camera: {
      transport: ['mock', 'ptpip', 'sdk-bridge'].includes(transport) ? transport : 'mock',
      host: str(env, 'CAMERA_HOST', '192.168.0.1'),
      port: num(env, 'CAMERA_PORT', 55740),
      dryRun: bool(env, 'CAMERA_DRY_RUN', false),
      allowUnverified: bool(env, 'ALLOW_UNVERIFIED_PROPS', false),
      propertyOverridePath: str(
        env,
        'PROPERTY_OVERRIDES',
        path.join(PROJECT_ROOT, 'config', 'fuji-properties.json'),
      ),
      sdkBridgeUrl: str(env, 'SDK_BRIDGE_URL', 'http://127.0.0.1:8787'),
      friendlyName: str(env, 'CAMERA_CLIENT_NAME', 'X100VI-AI-Assistant'),
    },

    ai: {
      model: str(env, 'AI_MODEL', 'claude-opus-5'),
      effort: str(env, 'AI_EFFORT', 'medium') as AppConfig['ai']['effort'],
      // APIキーが無ければ自動的にオフライン（ルールベース）で動く
      offline: bool(env, 'AI_OFFLINE', !env.ANTHROPIC_API_KEY),
      timeoutMs: num(env, 'AI_TIMEOUT_MS', 45_000),
    },

    allowAutoApply: bool(env, 'ALLOW_AUTO_APPLY', true),
  };
}
