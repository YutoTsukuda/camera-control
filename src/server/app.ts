/**
 * ブリッジサーバ。
 *
 * スマートフォンのブラウザからは生の TCP を扱えないため、
 * 「スマホ ↔ HTTP ↔ このサーバ ↔ カメラ」という構成にしている。
 * Claude の API キーもここに置き、端末側には一切渡さない。
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { adviseSettings, type AdvisorInput } from '../ai/index.js';
import { createCamera } from '../camera/factory.js';
import { CameraNotConnectedError, type CameraAdapter } from '../camera/types.js';
import { PROJECT_ROOT, type AppConfig } from '../config.js';
import * as caps from '../domain/capabilities.js';
import * as labels from '../domain/labels.js';
import { formatShutter } from '../domain/exposure.js';
import { SCENE_TABLE } from '../domain/scenes.js';
import { validateSettings } from '../domain/validate.js';
import type { ShootingSettings } from '../domain/types.js';
import { serveStatic } from './static.js';

/** 画像を含むため上限は大きめに取るが、無制限にはしない。 */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export interface AppServer {
  server: http.Server;
  camera: CameraAdapter;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export function createApp(config: AppConfig): AppServer {
  const logListeners = new Set<(entry: LogEntry) => void>();
  const recentLogs: LogEntry[] = [];

  const log = (level: LogEntry['level'], message: string) => {
    const entry: LogEntry = { at: new Date().toISOString(), level, message };
    recentLogs.push(entry);
    if (recentLogs.length > 200) recentLogs.shift();
    console[level === 'error' ? 'error' : 'log'](`[${entry.at}] ${message}`);
    for (const listener of logListeners) listener(entry);
  };

  const camera = createCamera(config, (msg) => log('info', `camera: ${msg}`));
  const webRoot = path.join(PROJECT_ROOT, 'src', 'web');

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log('error', `未処理のエラー: ${String(error)}`);
      if (!res.headersSent) sendJson(res, 500, { error: '内部エラーが発生しました。' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const route = `${req.method} ${url.pathname}`;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders()).end();
      return;
    }

    // API はアクセストークンで保護する。
    // カメラの Wi-Fi アクセスポイントは同じネットワークに誰でも入れる場合があるため、
    // 屋外運用ではトークンを設定することを強く推奨する。
    if (url.pathname.startsWith('/api/') && config.accessToken) {
      const provided = req.headers['x-access-token'] ?? url.searchParams.get('token');
      if (provided !== config.accessToken) {
        sendJson(res, 401, { error: 'アクセストークンが不正です。' });
        return;
      }
    }

    switch (route) {
      case 'GET /api/health':
        sendJson(res, 200, {
          ok: true,
          transport: config.camera.transport,
          aiMode: config.ai.offline ? 'rules' : 'claude',
          model: config.ai.offline ? null : config.ai.model,
          dryRun: config.camera.dryRun,
        });
        return;

      case 'GET /api/capabilities':
        sendJson(res, 200, capabilitiesPayload());
        return;

      case 'GET /api/camera/status':
        sendJson(res, 200, await camera.getStatus());
        return;

      case 'POST /api/camera/connect': {
        try {
          const status = await camera.connect();
          log('info', `カメラに接続しました (${status.model ?? 'unknown'})`);
          sendJson(res, 200, status);
        } catch (error) {
          log('error', `接続失敗: ${String(error)}`);
          sendJson(res, 502, { error: messageOf(error) });
        }
        return;
      }

      case 'POST /api/camera/disconnect':
        await camera.disconnect();
        log('info', 'カメラを切断しました');
        sendJson(res, 200, { ok: true });
        return;

      case 'POST /api/advise': {
        const body = await readJson(req);
        const proposal = await advise(body);
        sendJson(res, 200, proposal);
        return;
      }

      case 'POST /api/apply': {
        const body = await readJson<{ settings?: ShootingSettings }>(req);
        if (!body.settings) {
          sendJson(res, 400, { error: 'settings が必要です。' });
          return;
        }
        const validated = validateSettings(body.settings);
        try {
          const result = await camera.applySettings(validated.settings);
          log(
            result.ok ? 'info' : 'warn',
            `設定を適用: ${result.outcomes.filter((o) => o.status === 'applied').length}/${result.outcomes.length} 項目成功 (${result.elapsedMs}ms)`,
          );
          sendJson(res, 200, { ...result, corrections: validated.corrections });
        } catch (error) {
          sendJson(res, error instanceof CameraNotConnectedError ? 409 : 502, {
            error: messageOf(error),
          });
        }
        return;
      }

      case 'POST /api/auto': {
        if (!config.allowAutoApply) {
          sendJson(res, 403, { error: '自動適用は無効化されています。' });
          return;
        }
        const body = await readJson(req);
        const proposal = await advise(body);
        try {
          const result = await camera.applySettings(proposal.settings);
          log(
            result.ok ? 'info' : 'warn',
            `AI提案を自動適用 (${proposal.source}): ${result.outcomes.filter((o) => o.status === 'applied').length}/${result.outcomes.length} 項目成功`,
          );
          sendJson(res, 200, { proposal, apply: result });
        } catch (error) {
          sendJson(res, error instanceof CameraNotConnectedError ? 409 : 502, {
            error: messageOf(error),
            proposal,
          });
        }
        return;
      }

      case 'POST /api/capture': {
        if (!camera.triggerCapture) {
          sendJson(res, 501, { error: 'この接続方式はレリーズに対応していません。' });
          return;
        }
        try {
          await camera.triggerCapture();
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 502, { error: messageOf(error) });
        }
        return;
      }

      case 'GET /api/events':
        streamLogs(res);
        return;

      default:
        break;
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (await serveStatic(webRoot, url.pathname, res)) return;
      if (await serveStatic(webRoot, '/index.html', res)) return;
    }

    sendJson(res, 404, { error: 'not found' });
  }

  /**
   * 提案を作る。カメラが接続済みなら実測の測光値を優先的に使う。
   */
  async function advise(body: Record<string, unknown>): Promise<Awaited<ReturnType<typeof adviseSettings>>> {
    const input: AdvisorInput = {
      intent: (body.intent as AdvisorInput['intent']) ?? {},
      scene: (body.scene as AdvisorInput['scene']) ?? {},
    };
    if (typeof body.image === 'string' && body.image.length > 0) {
      input.imageBase64 = body.image;
    }

    if (input.scene?.ev100 === undefined) {
      try {
        const status = await camera.getStatus();
        if (status.connected) {
          if (status.meteredEv100 !== undefined) {
            input.scene = { ...input.scene, ev100: status.meteredEv100 };
          }
          if (status.current) {
            input.cameraReadout = { 現在の設定: status.current };
          }
        }
      } catch {
        // 測光値が取れなくても提案自体は続行する
      }
    }

    const started = Date.now();
    const proposal = await adviseSettings(input, {
      offline: config.ai.offline,
      model: config.ai.model,
      effort: config.ai.effort,
      timeoutMs: config.ai.timeoutMs,
    });
    log(
      proposal.source === 'claude' ? 'info' : 'warn',
      `提案を生成 (${proposal.source}, ${Date.now() - started}ms)` +
        (proposal.fallbackReason ? ` — フォールバック理由: ${proposal.fallbackReason}` : ''),
    );
    return proposal;
  }

  function streamLogs(res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...corsHeaders(),
    });
    const send = (entry: LogEntry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
    for (const entry of recentLogs.slice(-20)) send(entry);
    logListeners.add(send);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(keepAlive);
      logListeners.delete(send);
    });
  }

  return {
    server,
    camera,
    listen() {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          const address = server.address();
          const port = typeof address === 'object' && address ? address.port : config.port;
          log('info', `サーバ起動: http://${config.host}:${port}`);
          log(
            'info',
            `カメラ接続方式: ${config.camera.transport}${config.camera.dryRun ? '（dry-run）' : ''} / AI: ${config.ai.offline ? 'ルールベース' : config.ai.model}`,
          );
          resolve({ host: config.host, port });
        });
      });
    },
    async close() {
      await camera.disconnect().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** UI が選択肢を描画するために必要な情報を、ドメイン層からそのまま配信する。 */
function capabilitiesPayload() {
  return {
    model: 'FUJIFILM X100VI',
    lens: { focalLengthMm: caps.FOCAL_LENGTH_MM, equivMm: caps.FOCAL_LENGTH_EQUIV_MM, maxAperture: 2 },
    apertures: caps.APERTURES,
    shutterSpeeds: caps.SHUTTER_SPEEDS.map((sec) => ({ sec, label: formatShutter(sec) })),
    leafShutterLimits: caps.LEAF_SHUTTER_LIMITS.map((row) => ({
      maxAperture: row.maxAperture,
      fastestSec: row.fastestSec,
      label: formatShutter(row.fastestSec),
    })),
    ndFilterStops: caps.ND_FILTER_STOPS,
    isoNative: caps.ISO_NATIVE,
    isoExtendedLow: caps.ISO_EXTENDED_LOW,
    isoExtendedHigh: caps.ISO_EXTENDED_HIGH,
    exposureCompensation: caps.EXPOSURE_COMPENSATION_RANGE,
    toneRanges: caps.TONE_RANGES,
    scenes: SCENE_TABLE,
    labels: {
      filmSimulation: labels.FILM_SIMULATION_LABELS,
      filmSimulationNotes: labels.FILM_SIMULATION_NOTES,
      whiteBalance: labels.WHITE_BALANCE_LABELS,
      exposureMode: labels.EXPOSURE_MODE_LABELS,
      shutterType: labels.SHUTTER_TYPE_LABELS,
      dynamicRange: labels.DYNAMIC_RANGE_LABELS,
      dRangePriority: labels.D_RANGE_PRIORITY_LABELS,
      metering: labels.METERING_LABELS,
      focusMode: labels.FOCUS_MODE_LABELS,
      afArea: labels.AF_AREA_LABELS,
      subjectDetection: labels.SUBJECT_DETECTION_LABELS,
      driveMode: labels.DRIVE_MODE_LABELS,
      imageQuality: labels.IMAGE_QUALITY_LABELS,
      grain: labels.GRAIN_LABELS,
      colorChrome: labels.COLOR_CHROME_LABELS,
      field: labels.FIELD_LABELS,
    },
  };
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-access-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...corsHeaders(),
  });
  res.end(payload);
}

async function readJson<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('リクエストが大きすぎます。');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
