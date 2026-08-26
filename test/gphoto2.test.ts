import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseAperture,
  parseAutoDetect,
  parseConfigList,
  parseExposureCompensation,
  parseIso,
  parseShutterSeconds,
  parseSignedNumber,
} from '../src/camera/gphoto2/parse.js';
import { encodeSet, resolveMapping } from '../src/camera/gphoto2/mapping.js';
import { explainGphoto2Error } from '../src/camera/gphoto2/cli.js';
import {
  AUTO_DETECT,
  AUTO_DETECT_EMPTY,
  LIST_ALL_CONFIG,
  LIST_ALL_CONFIG_WITH_END,
} from './fixtures/gphoto2.js';
import type { ResolvedField } from '../src/camera/gphoto2/mapping.js';

const entries = parseConfigList(LIST_ALL_CONFIG);
const report = resolveMapping(entries);
const byField = new Map(report.resolved.map((r) => [r.field, r]));
const need = (field: string): ResolvedField => {
  const resolved = byField.get(field as never);
  assert.ok(resolved, `${field} が解決されていない`);
  return resolved;
};

describe('gphoto2 設定ツリーのパース', () => {
  it('END 区切りが無い版（2.5.28系）を読める', () => {
    assert.equal(entries.length, 18);
    const aperture = entries.find((e) => e.name === 'f-number');
    assert.equal(aperture?.path, '/main/capturesettings/f-number');
    assert.equal(aperture?.label, 'F-Number');
    assert.equal(aperture?.type, 'RADIO');
    assert.equal(aperture?.current, 'f/5.6');
    assert.equal(aperture?.choices.length, 11);
    assert.deepEqual(aperture?.choices[3], { index: 3, value: 'f/2.8' });
  });

  it('END 区切りがある版も読める', () => {
    const withEnd = parseConfigList(LIST_ALL_CONFIG_WITH_END);
    assert.equal(withEnd.length, 2);
    assert.equal(withEnd[0]?.choices.length, 2);
    assert.deepEqual(withEnd[1]?.range, { bottom: 1, top: 100, step: 1 });
  });

  it('読み取り専用フラグを拾う', () => {
    assert.equal(entries.find((e) => e.name === 'batterylevel')?.readonly, true);
    assert.equal(entries.find((e) => e.name === 'f-number')?.readonly, false);
  });

  it('空白を含む選択肢を壊さない', () => {
    const film = entries.find((e) => e.name === 'filmsimulation');
    assert.equal(film?.choices[9]?.value, 'Eterna Bleach Bypass');
    assert.equal(film?.choices[4]?.value, 'Pro Neg. Hi');
  });

  it('auto-detect を解析できる', () => {
    const cameras = parseAutoDetect(AUTO_DETECT);
    assert.equal(cameras.length, 1);
    assert.equal(cameras[0]?.model, 'Fujifilm X100VI');
    assert.equal(cameras[0]?.port, 'usb:001,009');
    assert.equal(parseAutoDetect(AUTO_DETECT_EMPTY).length, 0);
  });
});

describe('選択肢の数値解釈', () => {
  it('絞り', () => {
    assert.equal(parseAperture('f/2.8'), 2.8);
    assert.equal(parseAperture('F2'), 2);
    assert.equal(parseAperture('5.6'), 5.6);
    assert.equal(parseAperture('Unknown'), undefined);
  });

  it('シャッター速度', () => {
    assert.equal(parseShutterSeconds('1/250'), 0.004);
    assert.equal(parseShutterSeconds('30'), 30);
    assert.equal(parseShutterSeconds('2.5s'), 2.5);
    assert.equal(parseShutterSeconds('Bulb'), undefined);
  });

  it('ISO', () => {
    assert.equal(parseIso('400'), 400);
    assert.equal(parseIso('Auto'), 'AUTO');
    assert.equal(parseIso('ISO 1600'), 1600);
  });

  it('露出補正（分数表記と小数表記の両方）', () => {
    assert.ok(Math.abs((parseExposureCompensation('1/3') as number) - 1 / 3) < 1e-9);
    assert.ok(Math.abs((parseExposureCompensation('-5/3') as number) + 5 / 3) < 1e-9);
    assert.equal(parseExposureCompensation('0'), 0);
    assert.equal(parseExposureCompensation('+2'), 2);
    assert.equal(parseExposureCompensation('-0.3'), -0.3);
  });
});

describe('符号つき数値の解釈', () => {
  it('トーンカーブやWBシフトの表記を読む', () => {
    assert.equal(parseSignedNumber('+1'), 1);
    assert.equal(parseSignedNumber('-2'), -2);
    assert.equal(parseSignedNumber('0'), 0);
    assert.equal(parseSignedNumber('±0'), 0);
    assert.equal(parseSignedNumber('+0.5'), 0.5);
    assert.equal(parseSignedNumber('Auto'), undefined);
    assert.equal(parseSignedNumber('Off'), undefined);
  });
});

describe('光の調整と色のバランス', () => {
  it('ハイライト/シャドウトーンを解決する', () => {
    assert.equal(need('highlightTone').path, '/main/capturesettings/highlighttone');
    assert.equal(need('shadowTone').path, '/main/capturesettings/shadowtone');
  });

  it('選択肢つきのトーンは最も近い値へ丸める', () => {
    const result = encodeSet(need('highlightTone'), -0.7);
    assert.ok('set' in result);
    assert.equal(result.set.display, '-0.5');
  });

  it('カメラに無い刻みは持っている刻みへ落ちる', () => {
    // shadowtone は 1 刻みしか持たないフィクスチャ
    const result = encodeSet(need('shadowTone'), -1.4);
    assert.ok('set' in result);
    assert.equal(result.set.display, '-1');
  });

  it('RANGE型は範囲と刻みに合わせて丸める', () => {
    const sharpness = need('sharpness');
    assert.deepEqual(sharpness.range, { bottom: -4, top: 4, step: 1 });

    const inRange = encodeSet(sharpness, 2.4);
    assert.ok('set' in inRange);
    assert.equal(inRange.set.value, '2');

    const overshoot = encodeSet(sharpness, 99);
    assert.ok('set' in overshoot);
    assert.equal(overshoot.set.value, '4', '範囲外の値は上限で止めるべき');
  });

  it('WBシフト（RGBバランス）の2軸を解決する', () => {
    assert.equal(need('wbShiftRed').path, '/main/imgsettings/whitebalanceadjusta');
    assert.equal(need('wbShiftBlue').path, '/main/imgsettings/whitebalanceadjustb');

    const red = encodeSet(need('wbShiftRed'), 3);
    assert.ok('set' in red);
    assert.equal(red.set.value, '3');

    const clamped = encodeSet(need('wbShiftBlue'), -20);
    assert.ok('set' in clamped);
    assert.equal(clamped.set.value, '-9', 'WBシフトは -9 が下限');
  });

  it('色温度は100K刻みに丸める', () => {
    const result = encodeSet(need('whiteBalanceKelvin'), 5432);
    assert.ok('set' in result);
    assert.equal(result.set.value, '5400');
  });
});

describe('フィールドの解決', () => {
  it('主要フィールドを実機の設定ツリーから解決する', () => {
    for (const field of ['aperture', 'shutterSpeedSec', 'iso', 'exposureCompensation', 'filmSimulation']) {
      assert.ok(byField.has(field as never), `${field} が解決されていない`);
    }
    assert.equal(need('aperture').path, '/main/capturesettings/f-number');
    assert.equal(need('iso').path, '/main/imgsettings/iso');
  });

  it('読み取り専用のフィールドは採用しない', () => {
    // フィクスチャの focusmode は Readonly: 1
    assert.equal(byField.has('focusMode' as never), false);
    const reason = report.unresolved.find((u) => u.field === 'focusMode')?.reason;
    assert.match(reason ?? '', /読み取り専用/);
  });

  it('カメラに無いフィールドは理由つきで未解決にする', () => {
    const unresolvedFields = report.unresolved.map((u) => u.field);
    assert.ok(unresolvedFields.includes('ndFilter'));
    assert.match(
      report.unresolved.find((u) => u.field === 'ndFilter')?.reason ?? '',
      /設定ツリーに存在しません/,
    );
  });

  it('フィルムシミュレーション20種すべてを正しい選択肢へ照合する', () => {
    const film = need('filmSimulation');
    const byIndex = new Map(film.choices.map((c) => [c.index, c.value]));
    const map = film.valueMap ?? {};
    assert.equal(byIndex.get(map.PROVIA_STD as number), 'Provia/Standard');
    assert.equal(byIndex.get(map.CLASSIC_CHROME as number), 'Classic Chrome');
    assert.equal(byIndex.get(map.CLASSIC_NEG as number), 'Classic Neg.');
    assert.equal(byIndex.get(map.NOSTALGIC_NEG as number), 'Nostalgic Neg.');
    assert.equal(byIndex.get(map.ETERNA_CINEMA as number), 'Eterna/Cinema');
    assert.equal(byIndex.get(map.ETERNA_BLEACH_BYPASS as number), 'Eterna Bleach Bypass');
    assert.equal(byIndex.get(map.REALA_ACE as number), 'Reala Ace');
    assert.equal(byIndex.get(map.PRO_NEG_HI as number), 'Pro Neg. Hi');
    assert.equal(byIndex.get(map.PRO_NEG_STD as number), 'Pro Neg. Std');
    assert.equal(byIndex.get(map.SEPIA as number), 'Sepia');
    assert.equal(film.unmatchedValues, undefined);
  });

  it('ACROS と ACROS+R のような紛らわしい選択肢を取り違えない', () => {
    const film = need('filmSimulation');
    const byIndex = new Map(film.choices.map((c) => [c.index, c.value]));
    const map = film.valueMap ?? {};
    assert.equal(byIndex.get(map.ACROS as number), 'Acros');
    assert.equal(byIndex.get(map.ACROS_YE as number), 'Acros+Ye');
    assert.equal(byIndex.get(map.ACROS_R as number), 'Acros+R');
    assert.equal(byIndex.get(map.ACROS_G as number), 'Acros+G');
    assert.equal(byIndex.get(map.MONOCHROME as number), 'Monochrome');
    assert.equal(byIndex.get(map.MONOCHROME_R as number), 'Monochrome+R');
    // すべて別の選択肢に割り当たっていること
    const assigned = [map.ACROS, map.ACROS_YE, map.ACROS_R, map.ACROS_G];
    assert.equal(new Set(assigned).size, 4);
  });

  it('カメラに存在しない選択肢は未照合として報告する', () => {
    // フィクスチャの WB には水中・オート白優先などが無い
    const wb = need('whiteBalance');
    assert.ok(wb.unmatchedValues?.includes('UNDERWATER'));
    assert.equal(wb.valueMap?.SHADE !== undefined, true);
    assert.equal(wb.valueMap?.KELVIN !== undefined, true);
  });
});

describe('書き込み値の符号化', () => {
  it('絞りは最も近い選択肢を選ぶ', () => {
    const result = encodeSet(need('aperture'), 2.9);
    assert.ok('set' in result);
    assert.equal(result.set.display, 'f/2.8');
    assert.equal(result.set.index, 3);
  });

  it('シャッター速度は対数距離で選ぶ', () => {
    const result = encodeSet(need('shutterSpeedSec'), 1 / 200);
    assert.ok('set' in result);
    assert.equal(result.set.display, '1/250');
  });

  it('ISO の AUTO を専用の選択肢へ写す', () => {
    const result = encodeSet(need('iso'), 'AUTO');
    assert.ok('set' in result);
    assert.equal(result.set.display, 'Auto');
    assert.equal(result.set.index, 0);
  });

  it('ISO の数値は最も近い常用感度へ落ちる', () => {
    const result = encodeSet(need('iso'), 500);
    assert.ok('set' in result);
    assert.equal(result.set.display, '400');
  });

  it('露出補正は線形距離で選ぶ', () => {
    const result = encodeSet(need('exposureCompensation'), 0.4);
    assert.ok('set' in result);
    assert.equal(result.set.display, '1/3');
  });

  it('列挙はインデックス指定にする（文字列の曖昧さを避ける）', () => {
    const result = encodeSet(need('filmSimulation'), 'CLASSIC_NEG');
    assert.ok('set' in result);
    assert.equal(result.set.display, 'Classic Neg.');
    assert.equal(typeof result.set.index, 'number');
    assert.equal(result.set.value, undefined);
  });

  it('カメラに無い列挙値は理由つきで拒否し、選択肢を示す', () => {
    const result = encodeSet(need('whiteBalance'), 'UNDERWATER');
    assert.ok('reason' in result);
    assert.match(result.reason, /このカメラの選択肢/);
  });
});

describe('エラーメッセージの翻訳', () => {
  it('gvfs による占有を具体的な対処つきで説明する', () => {
    const message = explainGphoto2Error({
      stdout: '',
      stderr: 'Could not claim the USB device',
      code: 1,
    });
    assert.match(message, /gvfs/);
    assert.match(message, /systemctl/);
  });

  it('カメラ未検出は USB接続モードの確認を促す', () => {
    const message = explainGphoto2Error({ stdout: '', stderr: 'No camera found.', code: 1 });
    assert.match(message, /USB接続モード/);
  });

  it('読み取り専用エラーは物理ダイヤルの可能性を示す', () => {
    const message = explainGphoto2Error({
      stdout: '',
      stderr: 'Property /main/capturesettings/f-number is read only.',
      code: 1,
    });
    assert.match(message, /ダイヤル/);
  });
});
