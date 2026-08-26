import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp, type AppServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';

describe('ブリッジサーバ（モックカメラ + オフラインAI）', () => {
  let app: AppServer;
  let base: string;

  before(async () => {
    app = createApp(
      loadConfig({
        PORT: '0',
        HOST: '127.0.0.1',
        CAMERA_TRANSPORT: 'mock',
        AI_OFFLINE: 'true',
        ACCESS_TOKEN: 'test-token',
      } as NodeJS.ProcessEnv),
    );
    const { port } = await app.listen();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await app.close();
  });

  /** レスポンス JSON を any として扱うテスト用ヘルパ。 */
  const json = async (res: Response): Promise<any> => res.json();

  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        'x-access-token': 'test-token',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });

  it('トークンが無いAPI呼び出しは401', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 401);
  });

  it('ヘルスチェック', async () => {
    const res = await call('/api/health');
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.ok, true);
    assert.equal(body.transport, 'mock');
    assert.equal(body.aiMode, 'rules');
  });

  it('機種の設定可能値を配信する', async () => {
    const body = await json(await call('/api/capabilities'));
    assert.equal(body.model, 'FUJIFILM X100VI');
    assert.ok(body.apertures.includes(2));
    assert.ok(body.apertures.includes(16));
    assert.equal(body.ndFilterStops, 4);
    assert.ok(body.labels.filmSimulation.ACROS);
    // リーフシャッターの絞り依存上限がUIまで届いていること
    assert.equal(body.leafShutterLimits[0].label, '1/1000');
  });

  it('接続 → 提案 → 適用の一連が通る', async () => {
    const connect = await json(await call('/api/camera/connect', { method: 'POST' }));
    assert.equal(connect.connected, true);

    const proposal = await json(
      await call('/api/advise', {
        method: 'POST',
        body: JSON.stringify({
          intent: { subject: 'PERSON', priority: 'BOKEH', support: 'HANDHELD' },
          scene: { ev100: 12 },
        }),
      }),
    );
    assert.equal(proposal.source, 'rules');
    assert.ok(proposal.settings.aperture <= 2.8, 'ボケ優先なら開放側');
    assert.ok(proposal.rationale.length > 0);

    const applied = await json(
      await call('/api/apply', {
        method: 'POST',
        body: JSON.stringify({ settings: proposal.settings }),
      }),
    );
    assert.equal(applied.ok, true, JSON.stringify(applied.outcomes?.filter((o: { status: string }) => o.status !== 'applied')));

    const status = await json(await call('/api/camera/status'));
    assert.equal(status.current.filmSimulation, proposal.settings.filmSimulation);
    assert.equal(status.current.aperture, proposal.settings.aperture);
  });

  it('未接続でも提案は返る（適用だけが失敗する）', async () => {
    await call('/api/camera/disconnect', { method: 'POST' });
    const proposal = await json(
      await call('/api/advise', { method: 'POST', body: JSON.stringify({ scene: { ev100: 15 } }) }),
    );
    assert.ok(proposal.settings.aperture !== undefined);

    const res = await call('/api/apply', {
      method: 'POST',
      body: JSON.stringify({ settings: proposal.settings }),
    });
    assert.equal(res.status, 409);
  });

  it('settings が無い適用要求は400', async () => {
    const res = await call('/api/apply', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(res.status, 400);
  });

  it('PWA の入口を配信する', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await res.text(), /X100VI/);
  });

  it('静的ファイルの外へは出られない', async () => {
    const res = await fetch(`${base}/../package.json`);
    // パス正規化で / に丸められるか、404 になる。package.json が漏れないことが要件。
    assert.ok(!(await res.text()).includes('"devDependencies"'));
  });
});
