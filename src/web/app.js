// スマホ側 UI。ビルド不要の素の ES モジュールで動かす（現場でエディタ無しでも直せるように）。

const $ = (id) => document.getElementById(id);
const state = {
  image: null,          // data URL（縮小済み）
  intent: loadIntent(),
  capabilities: null,
  proposal: null,
  token: new URL(location.href).searchParams.get('token') || localStorage.getItem('x100vi.token') || '',
};
if (state.token) localStorage.setItem('x100vi.token', state.token);

// --- 通信 -----------------------------------------------------------------

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  if (state.token) headers['x-access-token'] = state.token;
  const res = await fetch(path, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// --- 画像: アップロード前に縮小する ---------------------------------------
// 40MP の原寸を送ると遅く高価なので、長辺1280pxのJPEGに落とす。
// AIがシーンの光を読むのにこれ以上の解像度は要らない。

const MAX_EDGE = 1280;

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.8);
}

// --- 意図の入力 -----------------------------------------------------------

function loadIntent() {
  try {
    return JSON.parse(localStorage.getItem('x100vi.intent')) || {};
  } catch {
    return {};
  }
}

function saveIntent() {
  localStorage.setItem('x100vi.intent', JSON.stringify(state.intent));
}

function wireChipGroup(group) {
  const container = document.querySelector(`.chips[data-group="${group}"]`);
  if (!container) return;
  container.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    const value = chip.dataset.value;
    // 同じものをもう一度押したら解除（＝「指定なし」に戻せる）
    state.intent[group] = state.intent[group] === value ? undefined : value;
    saveIntent();
    renderChipGroup(group);
  });
  renderChipGroup(group);
}

function renderChipGroup(group) {
  document.querySelectorAll(`.chips[data-group="${group}"] .chip`).forEach((chip) => {
    chip.setAttribute('aria-pressed', String(state.intent[group] === chip.dataset.value));
  });
}

// --- 表示ヘルパ -----------------------------------------------------------

function formatShutter(sec) {
  if (sec === undefined || sec === null) return '–';
  if (sec >= 1) return `${Number.isInteger(sec) ? sec : sec.toFixed(1)}"`;
  return `1/${Math.round(1 / sec)}`;
}

function formatValue(field, value, labels) {
  if (value === undefined || value === null) return '–';
  if (field === 'shutterSpeedSec' || field === 'isoAutoMinShutterSec') return formatShutter(value);
  if (field === 'aperture') return `F${value}`;
  if (field === 'exposureCompensation') return `${value > 0 ? '+' : ''}${value.toFixed(2)} EV`;
  if (field === 'iso') return value === 'AUTO' ? 'AUTO' : `ISO ${value}`;
  const map = {
    filmSimulation: labels.filmSimulation,
    whiteBalance: labels.whiteBalance,
    exposureMode: labels.exposureMode,
    shutterType: labels.shutterType,
    dynamicRange: labels.dynamicRange,
    dRangePriority: labels.dRangePriority,
    meteringMode: labels.metering,
    focusMode: labels.focusMode,
    afArea: labels.afArea,
    subjectDetection: labels.subjectDetection,
    driveMode: labels.driveMode,
    imageQuality: labels.imageQuality,
    grainEffect: labels.grain,
    colorChromeEffect: labels.colorChrome,
    colorChromeFxBlue: labels.colorChrome,
  }[field];
  if (map && map[value]) return map[value];
  if (typeof value === 'number') return String(value);
  return String(value);
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 3200);
}

// --- 提案の描画 -----------------------------------------------------------

function renderProposal(proposal) {
  state.proposal = proposal;
  const labels = state.capabilities?.labels ?? {};
  const s = proposal.settings;
  const p = proposal.predictedExposure;

  $('proposal').hidden = false;
  $('proposalSource').textContent =
    (proposal.source === 'claude' ? 'AI（Claude）による提案' : 'ルールベースの標準提案') +
    ` ・ 確信度 ${Math.round(proposal.confidence * 100)}%` +
    (proposal.fallbackReason ? ` ・ ${proposal.fallbackReason}` : '');

  $('valAperture').textContent = s.aperture ? `F${s.aperture}` : '–';
  $('valShutter').textContent = formatShutter(s.shutterSpeedSec);
  $('valIso').textContent = s.iso === 'AUTO' ? 'AUTO' : s.iso ?? '–';
  $('valComp').textContent =
    s.exposureCompensation === undefined
      ? '–'
      : `${s.exposureCompensation > 0 ? '+' : ''}${s.exposureCompensation.toFixed(1)}`;

  $('predicted').textContent = p
    ? `想定露出: F${p.aperture} ・ ${formatShutter(p.shutterSpeedSec)} ・ ISO${p.iso}` +
      (p.ndFilter === 'ON' ? ' ・ ND使用' : '') +
      (s.iso === 'AUTO' ? '（ISOとSSはカメラが決定）' : '')
    : '';

  $('sceneAnalysis').textContent = proposal.sceneAnalysis ?? '';
  $('rationale').textContent = proposal.rationale ?? '';

  $('warnings').innerHTML = (proposal.warnings ?? [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join('');

  const corrections = proposal.corrections ?? [];
  $('correctionCount').textContent = corrections.length ? `(${corrections.length}件)` : '(なし)';
  $('corrections').innerHTML = corrections
    .map((c) => {
      const label = labels.field?.[c.field] ?? c.field;
      return `<li class="${c.severity === 'warn' ? 'warn' : ''}"><b>${escapeHtml(label)}</b>: ${escapeHtml(c.reason)}</li>`;
    })
    .join('');

  $('settingsList').innerHTML = Object.entries(s)
    .filter(([, v]) => v !== undefined)
    .map(([field, value]) => {
      const label = labels.field?.[field] ?? field;
      return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(formatValue(field, value, labels))}</dd>`;
    })
    .join('');

  $('applyResult').innerHTML = '';
  $('proposal').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

// --- カメラ状態 -----------------------------------------------------------

let lastConnected = null;

async function refreshStatus() {
  try {
    const status = await api('/api/camera/status');
    const badge = $('statusBadge');

    // 撮影中にケーブルが抜けた・カメラがスリープした場合に気づけるよう、
    // 接続 → 切断へ落ちた瞬間だけ理由つきで知らせる。
    if (lastConnected === true && status.connected === false) {
      toast(status.lastError ?? 'カメラとの接続が切れました。');
    }
    lastConnected = status.connected;
    badge.title = status.lastError ?? '';
    badge.textContent = status.connected
      ? `${status.model ?? '接続中'}${status.batteryPercent != null ? ` ・ ${status.batteryPercent}%` : ''}`
      : '未接続';
    badge.className = `badge ${status.connected ? 'badge--on' : 'badge--off'}`;
    $('connectBtn').textContent = status.connected ? '切断' : '接続';
    $('connectBtn').dataset.connected = String(status.connected);
    if (status.meteredEv100 != null) {
      $('evLabel').textContent = `カメラ測光 EV${status.meteredEv100.toFixed(1)}`;
    }
  } catch (error) {
    $('statusBadge').textContent = 'サーバ未応答';
    $('statusBadge').className = 'badge badge--off';
  }
}

// --- 初期化 ---------------------------------------------------------------

async function init() {
  ['subject', 'priority', 'motion', 'support'].forEach(wireChipGroup);
  $('wantRaw').checked = !!state.intent.wantRaw;
  $('monochrome').checked = !!state.intent.monochrome;
  $('note').value = state.intent.note ?? '';

  $('wantRaw').addEventListener('change', (e) => { state.intent.wantRaw = e.target.checked; saveIntent(); });
  $('monochrome').addEventListener('change', (e) => { state.intent.monochrome = e.target.checked; saveIntent(); });
  $('note').addEventListener('change', (e) => { state.intent.note = e.target.value.trim() || undefined; saveIntent(); });

  $('photoInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      state.image = await downscale(file);
      $('preview').src = state.image;
      $('previewWrap').hidden = false;
    } catch (error) {
      toast(`画像を読み込めませんでした: ${error.message}`);
    }
  });

  $('clearPhoto').addEventListener('click', () => {
    state.image = null;
    $('photoInput').value = '';
    $('previewWrap').hidden = true;
  });

  $('connectBtn').addEventListener('click', async () => {
    const connected = $('connectBtn').dataset.connected === 'true';
    $('statusBadge').className = 'badge badge--busy';
    $('statusBadge').textContent = connected ? '切断中…' : '接続中…';
    try {
      await api(connected ? '/api/camera/disconnect' : '/api/camera/connect', { method: 'POST' });
    } catch (error) {
      toast(error.message);
    }
    await refreshStatus();
  });

  $('adviseBtn').addEventListener('click', async () => {
    const button = $('adviseBtn');
    button.disabled = true;
    button.textContent = 'AIが考えています…';
    try {
      const scene = {};
      const ev = $('sceneSelect').value;
      if (ev !== '') scene.ev100 = Number(ev);
      const proposal = await api('/api/advise', {
        method: 'POST',
        body: JSON.stringify({ image: state.image, intent: state.intent, scene }),
      });
      renderProposal(proposal);
    } catch (error) {
      toast(`提案を取得できませんでした: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = 'AIに設定を提案してもらう';
    }
  });

  $('applyBtn').addEventListener('click', async () => {
    if (!state.proposal) return;
    const button = $('applyBtn');
    button.disabled = true;
    button.textContent = '適用中…';
    try {
      const result = await api('/api/apply', {
        method: 'POST',
        body: JSON.stringify({ settings: state.proposal.settings }),
      });
      const labels = state.capabilities?.labels ?? {};
      const applied = result.outcomes.filter((o) => o.status === 'applied');
      const failed = result.outcomes.filter((o) => o.status !== 'applied');
      $('applyResult').innerHTML =
        `<div class="${failed.length ? 'ng' : 'ok'}">${applied.length}/${result.outcomes.length} 項目を適用しました（${result.elapsedMs}ms）</div>` +
        failed
          .map((o) => `<div class="ng">・${escapeHtml(labels.field?.[o.field] ?? o.field)}: ${escapeHtml(o.detail ?? o.status)}</div>`)
          .join('');
      await refreshStatus();
    } catch (error) {
      $('applyResult').innerHTML = `<div class="ng">${escapeHtml(error.message)}</div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'カメラに適用';
    }
  });

  $('captureBtn').addEventListener('click', async () => {
    try {
      await api('/api/capture', { method: 'POST' });
      toast('シャッターを切りました');
    } catch (error) {
      toast(error.message);
    }
  });

  try {
    state.capabilities = await api('/api/capabilities');
    const select = $('sceneSelect');
    for (const scene of state.capabilities.scenes) {
      const option = document.createElement('option');
      option.value = String(scene.ev100);
      option.textContent = `${scene.labelJa}（EV${scene.ev100}）`;
      select.appendChild(option);
    }
  } catch (error) {
    toast('サーバに接続できません。ブリッジが起動しているか確認してください。');
  }

  // ログのライブ表示
  const events = new EventSource(`/api/events${state.token ? `?token=${encodeURIComponent(state.token)}` : ''}`);
  events.onmessage = (event) => {
    const entry = JSON.parse(event.data);
    const pre = $('log');
    pre.textContent += `${entry.at.slice(11, 19)} ${entry.message}\n`;
    pre.scrollTop = pre.scrollHeight;
  };

  await refreshStatus();
  setInterval(refreshStatus, 10_000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();
