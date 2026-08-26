import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Gphoto2Camera } from '../src/camera/gphoto2/adapter.js';
import type { Gphoto2Result, Gphoto2Runner } from '../src/camera/gphoto2/cli.js';
import { AUTO_DETECT, AUTO_DETECT_EMPTY, LIST_ALL_CONFIG } from './fixtures/gphoto2.js';
import { parseConfigList } from '../src/camera/gphoto2/parse.js';

/** gphoto2 を模したランナー。呼ばれた引数を記録し、応答を差し替えられる。 */
class FakeRunner implements Gphoto2Runner {
  calls: string[][] = [];
  failSetMatching?: RegExp;
  detectOutput = AUTO_DETECT;
  /** --get-config を通信エラーで失敗させる（カメラ離脱の再現）。 */
  getConfigError?: string;
  /** --get-config で返す現在値。パス → 値。 */
  currentValues: Record<string, string> = {};

  async run(args: string[]): Promise<Gphoto2Result> {
    this.calls.push(args);
    const ok = (stdout = ''): Gphoto2Result => ({ stdout, stderr: '', code: 0 });

    if (args[0] === '--auto-detect') return ok(this.detectOutput);
    if (args[0] === '--list-all-config') return ok(LIST_ALL_CONFIG);
    if (args[0] === '--trigger-capture') return ok();

    if (args[0] === '--get-config') {
      if (this.getConfigError) {
        return { stdout: '', stderr: this.getConfigError, code: 1 };
      }
      const wanted = args.filter((_, i) => i % 2 === 1);
      const entries = parseConfigList(LIST_ALL_CONFIG).filter((entry) =>
        wanted.includes(entry.path),
      );
      const rendered = entries
        .map((entry) => {
          const current = this.currentValues[entry.path] ?? entry.current;
          const choices = entry.choices.map((c) => `Choice: ${c.index} ${c.value}`).join('\n');
          return `${entry.path}\nLabel: ${entry.label}\nReadonly: ${entry.readonly ? 1 : 0}\nType: ${entry.type}\nCurrent: ${current}${choices ? `\n${choices}` : ''}`;
        })
        .join('\n');
      return ok(rendered);
    }

    if (args.some((arg) => arg.startsWith('--set-config'))) {
      if (this.failSetMatching && args.some((arg) => this.failSetMatching!.test(arg))) {
        return { stdout: '', stderr: 'Could not set configuration: Bad parameters', code: 1 };
      }
      return ok();
    }

    return ok();
  }

  /** 実際に送信された set 指示だけを平坦化して返す。 */
  setArgs(): string[] {
    return this.calls
      .filter((args) => args.some((arg) => arg.startsWith('--set-config')))
      .flat()
      .filter((arg) => arg.includes('='));
  }
}

const connectCamera = async (runner: FakeRunner) => {
  const camera = new Gphoto2Camera({ runner });
  const status = await camera.connect();
  return { camera, status };
};

describe('gphoto2 アダプタ', () => {
  it('接続時に実機を検出し、設定ツリーからマッピングを解決する', async () => {
    const runner = new FakeRunner();
    const { camera, status } = await connectCamera(runner);
    assert.equal(status.connected, true);
    assert.equal(status.model, 'Fujifilm X100VI');
    assert.equal(status.transport, 'gphoto2');
    assert.ok((camera.getMappingReport()?.resolved.length ?? 0) >= 8);
  });

  it('カメラが見つからなければ、確認すべき手順を含むエラーにする', async () => {
    const runner = new FakeRunner();
    runner.detectOutput = AUTO_DETECT_EMPTY;
    const camera = new Gphoto2Camera({ runner });
    await assert.rejects(() => camera.connect(), /USB接続モード/);
  });

  it('複数項目を1回のプロセス起動でまとめて書き込む', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);
    runner.calls = [];

    const result = await camera.applySettings({
      aperture: 2.8,
      shutterSpeedSec: 1 / 250,
      iso: 400,
      filmSimulation: 'CLASSIC_CHROME',
    });

    assert.equal(result.ok, true);
    assert.equal(result.outcomes.filter((o) => o.status === 'applied').length, 4);
    const setCalls = runner.calls.filter((args) =>
      args.some((arg) => arg.startsWith('--set-config')),
    );
    assert.equal(setCalls.length, 1, 'USBの往復は1回にまとめるべき');
  });

  it('列挙はインデックス指定で送る', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);
    runner.calls = [];
    await camera.applySettings({ filmSimulation: 'ACROS_R' });
    // フィクスチャで Acros+R は index 13
    assert.ok(runner.setArgs().includes('/main/capturesettings/filmsimulation=13'));
  });

  it('一括が失敗したら項目ごとに再実行して原因を特定する', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);
    runner.calls = [];
    runner.failSetMatching = /f-number/;

    const result = await camera.applySettings({
      aperture: 2.8,
      iso: 400,
      filmSimulation: 'VELVIA_VIVID',
    });

    assert.equal(result.ok, false);
    const failed = result.outcomes.filter((o) => o.status === 'failed');
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.field, 'aperture');
    assert.match(failed[0]?.detail ?? '', /排他|ダイヤル|受け付け/);
    // 残りは成功として扱われる
    assert.equal(result.outcomes.filter((o) => o.status === 'applied').length, 2);
  });

  it('カメラに無い項目は送らず、非対応として理由を返す', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);
    runner.calls = [];

    const result = await camera.applySettings({
      ndFilter: 'ON',        // フィクスチャに存在しない
      focusMode: 'AF_C',     // フィクスチャでは読み取り専用
      clarity: 2,            // そもそも対応表に無い
      aperture: 5.6,
    });

    const unsupported = result.outcomes.filter((o) => o.status === 'unsupported');
    assert.equal(unsupported.length, 3);
    for (const outcome of unsupported) {
      assert.ok((outcome.detail ?? '').length > 0, '理由が空');
    }
    // 送信されたのは絞りだけ
    assert.deepEqual(runner.setArgs(), ['/main/capturesettings/f-number=7']);
  });

  it('未接続での適用は例外にする', async () => {
    const camera = new Gphoto2Camera({ runner: new FakeRunner() });
    await assert.rejects(() => camera.applySettings({ aperture: 2.8 }), /接続されていません/);
  });

  it('現在の露出から被写体輝度(EV100)を逆算する', async () => {
    const runner = new FakeRunner();
    // F5.6 ・ 1/125 ・ ISO400 ・ 補正0 → EV100 = log2(31.36*125) - log2(4) ≒ 10.0
    runner.currentValues = {
      '/main/capturesettings/f-number': 'f/5.6',
      '/main/capturesettings/shutterspeed': '1/125',
      '/main/imgsettings/iso': '400',
      '/main/capturesettings/exposurecompensation': '0',
    };
    const { camera } = await connectCamera(runner);
    const status = await camera.getStatus();
    assert.ok(status.meteredEv100 !== undefined, '測光値が導出されていない');
    assert.ok(
      Math.abs((status.meteredEv100 as number) - 10) < 0.3,
      `EV${status.meteredEv100} は想定(約10)から外れている`,
    );
    assert.equal(status.current?.aperture, 5.6);
    assert.equal(status.current?.filmSimulation, 'PROVIA_STD');
  });

  it('ISOがAUTO表示のままなら測光値を導出しない（誤った値を出さない）', async () => {
    const runner = new FakeRunner();
    runner.currentValues = { '/main/imgsettings/iso': 'Auto' };
    const { camera } = await connectCamera(runner);
    const status = await camera.getStatus();
    assert.equal(status.meteredEv100, undefined);
    assert.equal(status.current?.iso, 'AUTO');
  });

  it('カメラが抜けたら接続状態を落とし、理由を残す', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);

    runner.getConfigError = 'Could not open the camera: PTP I/O Error';
    const lost = await camera.getStatus();
    assert.equal(lost.connected, false, '離脱を検知できていない');
    assert.match(lost.lastError ?? '', /USB/);

    // 適用も未接続として弾かれる（繋がっているつもりで書き込まない）
    await assert.rejects(() => camera.applySettings({ aperture: 2.8 }), /接続されていません/);
  });

  it('項目が読めないだけなら接続は維持する', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);
    runner.getConfigError = 'Could not set configuration: Bad parameters';
    const status = await camera.getStatus();
    assert.equal(status.connected, true, '通信は生きているので接続は維持されるべき');
    assert.ok((status.lastError ?? '').length > 0);
  });

  it('レリーズは転送を待たない --trigger-capture を使う', async () => {
    const runner = new FakeRunner();
    const { camera } = await connectCamera(runner);
    runner.calls = [];
    await camera.triggerCapture();
    assert.deepEqual(runner.calls[0], ['--trigger-capture']);
  });
});
