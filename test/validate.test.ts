import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateSettings } from '../src/domain/validate.js';

describe('設定バリデータ', () => {
  it('選べない絞りを丸める', () => {
    const { settings, corrections } = validateSettings({ aperture: 3 });
    assert.equal(settings.aperture, 3.2);
    assert.equal(corrections[0]?.field, 'aperture');
  });

  it('リーフシャッターの上限を超えるSSは電子シャッター併用に切り替える', () => {
    const { settings, corrections } = validateSettings({
      aperture: 2,
      shutterSpeedSec: 1 / 8000,
      shutterType: 'MS',
    });
    assert.equal(settings.shutterType, 'MS+ES');
    assert.ok(corrections.some((c) => c.field === 'shutterType' && c.severity === 'warn'));
  });

  it('F4以上ならメカシャッターで1/4000まで通す', () => {
    const { settings } = validateSettings({
      aperture: 5.6,
      shutterSpeedSec: 1 / 4000,
      shutterType: 'MS',
    });
    assert.equal(settings.shutterType, 'MS');
    assert.equal(settings.shutterSpeedSec, 1 / 4000);
  });

  it('DR400はISO500以上を要求する', () => {
    const { settings, corrections } = validateSettings({ dynamicRange: 'DR400', iso: 200 });
    assert.equal(settings.iso, 500);
    assert.ok(corrections.some((c) => c.field === 'iso' && c.severity === 'warn'));
  });

  it('Dレンジ優先が有効ならトーン設定を送らない', () => {
    const { settings } = validateSettings({
      dRangePriority: 'STRONG',
      dynamicRange: 'DR400',
      highlightTone: 2,
      shadowTone: -1,
    });
    assert.equal(settings.dynamicRange, undefined);
    assert.equal(settings.highlightTone, undefined);
    assert.equal(settings.shadowTone, undefined);
  });

  it('モノクロ系では彩度設定を落とす', () => {
    const { settings } = validateSettings({ filmSimulation: 'ACROS_R', color: 3, colorChromeEffect: 'STRONG' });
    assert.equal(settings.color, undefined);
    assert.equal(settings.colorChromeEffect, 'OFF');
  });

  it('露出補正を±5EV・1/3段に収める', () => {
    const { settings } = validateSettings({ exposureCompensation: 7 });
    assert.equal(settings.exposureCompensation, 5);
    const { settings: s2 } = validateSettings({ exposureCompensation: 0.4 });
    assert.ok(Math.abs((s2.exposureCompensation as number) - 1 / 3) < 1e-9);
  });

  it('RAW記録時はデジタルテレコンと拡張感度を無効にする', () => {
    const { settings, corrections } = validateSettings({
      imageQuality: 'FINE_RAW',
      digitalTeleconverter: 'X2_0',
      iso: 51200,
    });
    assert.equal(settings.digitalTeleconverter, 'OFF');
    assert.equal(settings.iso, 12800);
    assert.equal(corrections.filter((c) => c.severity === 'warn').length, 2);
  });

  it('色温度指定でないときはケルビン値を送らない', () => {
    const { settings } = validateSettings({ whiteBalance: 'AUTO', whiteBalanceKelvin: 5500 });
    assert.equal(settings.whiteBalanceKelvin, undefined);
  });

  it('色温度は範囲内に丸める', () => {
    const { settings } = validateSettings({ whiteBalance: 'KELVIN', whiteBalanceKelvin: 20000 });
    assert.equal(settings.whiteBalanceKelvin, 10000);
  });

  it('トーン調整の範囲を守る', () => {
    const { settings } = validateSettings({ highlightTone: 9, clarity: -12, sharpness: 2 });
    assert.equal(settings.highlightTone, 4);
    assert.equal(settings.clarity, -5);
    assert.equal(settings.sharpness, 2);
  });

  it('入力を破壊しない', () => {
    const input = { aperture: 3, color: 9 };
    validateSettings(input);
    assert.equal(input.aperture, 3);
    assert.equal(input.color, 9);
  });

  it('検証済みの設定を再検証しても何も変わらない（冪等）', () => {
    const first = validateSettings({
      aperture: 3,
      shutterSpeedSec: 1 / 8000,
      shutterType: 'MS',
      iso: 200,
      dynamicRange: 'DR400',
      filmSimulation: 'ACROS',
      color: 2,
      exposureCompensation: 0.4,
    });
    const second = validateSettings(first.settings);
    assert.deepEqual(second.settings, first.settings);
    assert.equal(
      second.corrections.filter((c) => c.severity !== 'note').length,
      0,
      '値を変える補正は2回目には残らないはず',
    );
  });
});
