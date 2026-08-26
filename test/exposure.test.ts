import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatShutter,
  handheldFloorSec,
  settingsEv,
  snapLog,
  solveExposure,
} from '../src/domain/exposure.js';
import { APERTURES, ISO_NATIVE, SHUTTER_SPEEDS, mechanicalFastestSec } from '../src/domain/capabilities.js';

describe('露出計算の基礎', () => {
  it('Sunny 16 の関係が成り立つ', () => {
    // F16・1/125秒・ISO100 は快晴の直射日光（EV15）に相当する
    assert.ok(Math.abs(settingsEv(16, 1 / 125, 100) - 15) < 0.05);
  });

  it('同じEVになる組み合わせは等価', () => {
    // F5.6 は実際には √32 = 5.657 の呼称値なので、公称値どうしの比較には
    // 0.03段程度の系統誤差が乗る。1/3段(0.33)より十分小さければ実用上等価。
    const a = settingsEv(8, 1 / 500, 100);
    const b = settingsEv(5.6, 1 / 1000, 100);
    assert.ok(Math.abs(a - b) < 0.05, `差 ${(a - b).toFixed(3)} 段`);
  });

  it('ISOを2倍にするとEVは1段下がる', () => {
    assert.ok(Math.abs(settingsEv(4, 1 / 250, 200) - (settingsEv(4, 1 / 250, 100) - 1)) < 1e-9);
  });

  it('シャッター速度の表記', () => {
    assert.equal(formatShutter(1 / 250), '1/250');
    assert.equal(formatShutter(2), '2"');
    assert.equal(formatShutter(1.6), '1.6"');
  });

  it('ラダーへの丸め込みは対数距離で行う', () => {
    assert.equal(snapLog(3, APERTURES), 3.2);
    assert.equal(snapLog(300, ISO_NATIVE), 320);
  });
});

describe('手ブレ限界', () => {
  it('三脚なら長秒を許容する', () => {
    assert.equal(handheldFloorSec({ support: 'TRIPOD' }), 30);
  });

  it('手持ちはIBISを見込んでも1/4秒までに抑える', () => {
    const floor = handheldFloorSec({ support: 'HANDHELD', motion: 'STILL' });
    assert.ok(floor <= 0.25);
    assert.ok(floor > 1 / 35, '35mm相当の1/35秒よりは遅くまで許容されるはず');
  });

  it('被写体が速く動く場合は手ブレより被写体ブレが下限を決める', () => {
    assert.equal(handheldFloorSec({ support: 'TRIPOD', motion: 'FAST' }), 1 / 500);
    assert.equal(handheldFloorSec({ support: 'HANDHELD', motion: 'FAST' }), 1 / 500);
  });
});

describe('露出ソルバ', () => {
  it('晴天の開放撮影ではNDを使ってメカシャッターの上限を守る', () => {
    const result = solveExposure({
      sceneEv100: 15,
      preferredAperture: 2,
      slowestShutterSec: 1 / 60,
      maxIso: 12800,
      allowStopDown: false,
      preferredShutterType: 'MS',
    });
    assert.equal(result.aperture, 2, '絞り開放は維持されるべき');
    assert.equal(result.ndFilter, 'ON', 'NDが入るべき');
    assert.ok(
      result.shutterSpeedSec >= mechanicalFastestSec(2) - 1e-12,
      `F2 のメカシャッター上限 ${formatShutter(mechanicalFastestSec(2))} を超えてはいけない`,
    );
    assert.ok(result.corrections.some((c) => c.field === 'ndFilter'));
  });

  it('暗いシーンではISOを上げてブレ限界を守る', () => {
    const result = solveExposure({
      sceneEv100: 5,
      preferredAperture: 2,
      slowestShutterSec: 1 / 60,
      maxIso: 12800,
    });
    assert.ok(result.iso > 125, 'ISOが上がるべき');
    assert.ok(result.shutterSpeedSec <= 1 / 60 + 1e-9);
  });

  it('ISO上限に達したら警告を出す', () => {
    const result = solveExposure({
      sceneEv100: 2,
      preferredAperture: 8,
      slowestShutterSec: 1 / 250,
      maxIso: 800,
      allowStopDown: false,
    });
    assert.ok(
      result.corrections.some((c) => c.severity === 'warn'),
      '実現できない条件では警告が出るべき',
    );
  });

  it('広い明るさの範囲で、機構上あり得ない値を返さない', () => {
    for (let ev = -1; ev <= 16; ev += 0.5) {
      for (const aperture of [2, 2.8, 5.6, 8, 16]) {
        const result = solveExposure({
          sceneEv100: ev,
          preferredAperture: aperture,
          slowestShutterSec: 1 / 60,
          maxIso: 12800,
        });
        assert.ok(APERTURES.includes(result.aperture), `F${result.aperture} は選択肢に無い`);
        assert.ok(ISO_NATIVE.includes(result.iso), `ISO${result.iso} は選択肢に無い`);
        assert.ok(
          SHUTTER_SPEEDS.some((s) => Math.abs(s - result.shutterSpeedSec) < 1e-9),
          `${formatShutter(result.shutterSpeedSec)} は選択肢に無い`,
        );
        assert.ok(result.shutterSpeedSec <= 30);
        if (result.shutterType === 'MS') {
          assert.ok(result.shutterSpeedSec >= mechanicalFastestSec(result.aperture) - 1e-12);
        }
      }
    }
  });

  it('実現可能な明るさなら露出誤差は1/2段以内に収まる', () => {
    for (let ev = 4; ev <= 15; ev += 0.5) {
      const result = solveExposure({
        sceneEv100: ev,
        preferredAperture: 5.6,
        slowestShutterSec: 1 / 60,
        maxIso: 12800,
      });
      assert.ok(
        Math.abs(result.errorEv) <= 0.5,
        `EV${ev} で露出誤差 ${result.errorEv.toFixed(2)} は大きすぎる`,
      );
    }
  });
});
