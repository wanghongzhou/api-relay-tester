// ── State ──
let TESTS = [];
let testResults = {};
let currentPricing = null;  // cached model pricing from /api/model-info

// ── LocalStorage persistence ──
const STORAGE_KEY = 'apitest_config';
const PRESET_URLS = ['https://api.favorais.com'];

function saveConfig() {
  const cfg = {
    baseUrl: document.getElementById('baseUrl').value,
    modelId: document.getElementById('modelId').value,
    apiKey: document.getElementById('apiKey').value,
    provider: document.getElementById('provider').value,
    simulateClaudeCodeCLI: document.getElementById('simulateClaudeCodeCLI').checked,
    useStreaming: document.getElementById('useStreaming').checked,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // No saved config — use first preset as default
      document.getElementById('baseUrl').value = PRESET_URLS[0];
      syncBaseUrlPreset();
      return;
    }
    const cfg = JSON.parse(raw);
    document.getElementById('baseUrl').value = cfg.baseUrl || PRESET_URLS[0];
    document.getElementById('modelId').value = cfg.modelId || '';
    document.getElementById('apiKey').value = cfg.apiKey || '';
    document.getElementById('provider').value = cfg.provider || '';
    document.getElementById('simulateClaudeCodeCLI').checked = !!cfg.simulateClaudeCodeCLI;
    document.getElementById('useStreaming').checked = !!cfg.useStreaming;
    syncBaseUrlPreset();
  } catch {
    document.getElementById('baseUrl').value = PRESET_URLS[0];
    syncBaseUrlPreset();
  }
}

/** Sync the preset dropdown to match the current baseUrl input */
function syncBaseUrlPreset() {
  const url = document.getElementById('baseUrl').value.trim();
  const preset = document.getElementById('baseUrlPreset');
  if (PRESET_URLS.includes(url)) {
    preset.value = url;
    document.getElementById('baseUrl').style.display = 'none';
  } else {
    preset.value = '__custom__';
    document.getElementById('baseUrl').style.display = '';
  }
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKey');
  const btn = document.getElementById('toggleApiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? '隐藏' : '显示';
}

function onBaseUrlPresetChange() {
  const preset = document.getElementById('baseUrlPreset');
  const input = document.getElementById('baseUrl');
  if (preset.value === '__custom__') {
    input.style.display = '';
    input.value = '';
    input.focus();
  } else {
    input.style.display = 'none';
    input.value = preset.value;
  }
  saveConfig();
}

// ── Init ──
async function init() {
  const [models, tests] = await Promise.all([
    fetch('/api/models').then(r => r.json()),
    fetch('/api/tests').then(r => r.json()),
  ]);

  // Populate model datalist
  const dl = document.getElementById('modelList');
  models.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.label = m.display; dl.appendChild(o); });

  TESTS = tests;
  renderTestCards();
  renderCompareChecks();
  addCompareRow();
  addCompareRow();

  // Restore saved config
  loadConfig();
  updateModelInfo();
  updateClaudeCodeOption();
  updateStreamingTestVisibility();

  // Event listeners — auto-save on any change
  document.getElementById('useStreaming').addEventListener('change', updateStreamingTestVisibility);
  const inputs = ['baseUrl', 'modelId', 'apiKey', 'provider', 'simulateClaudeCodeCLI', 'useStreaming'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', saveConfig);
    el.addEventListener('change', saveConfig);
  });
  // baseUrl input also syncs the preset dropdown
  document.getElementById('baseUrl').addEventListener('input', syncBaseUrlPreset);
  document.getElementById('modelId').addEventListener('input', () => { updateModelInfo(); updateClaudeCodeOption(); generateCustomJSON(); });
  document.getElementById('modelId').addEventListener('change', () => { updateModelInfo(); updateClaudeCodeOption(); generateCustomJSON(); });
  document.getElementById('provider').addEventListener('change', () => { updateClaudeCodeOption(); generateCustomJSON(); });

  // Generate initial custom JSON
  generateCustomJSON();
}

async function updateModelInfo() {
  const modelId = document.getElementById('modelId').value.trim();
  const bar = document.getElementById('modelBar');
  if (!modelId) { bar.classList.add('hidden'); return; }

  // Auto-detect provider
  const prov = document.getElementById('provider');
  if (!prov.value) {
    const l = modelId.toLowerCase();
    if (l.includes('claude')) prov.value = 'claude';
    else if (l.includes('gemini')) prov.value = 'gemini';
    else prov.value = 'openai';
  }

  const info = await fetch(`/api/model-info?id=${encodeURIComponent(modelId)}`).then(r => r.json());
  if (!info) {
    currentPricing = null;
    bar.className = 'model-bar unknown';
    bar.innerHTML = '<span>该模型不在官方数据库中。身份验证和上下文长度测试的比对能力将受到限制。</span>';
    bar.classList.remove('hidden');
    return;
  }
  currentPricing = info.pricing || null;
  const p = info.pricing || {};
  const fmt = (v) => v == null ? '无' : `$${v}`;
  bar.className = 'model-bar';
  bar.innerHTML = `
    <span class="item"><b>${info.displayName}</b></span>
    <span class="item">上下文: <b>${(info.contextWindow/1000).toFixed(0)}K</b></span>
    <span class="item">知识截止: <b>${info.knowledgeCutoff}</b></span>
    <span class="item">思维链: <b>${info.supportsThinking ? '✓' : '✗'}</b></span>
    <span class="item">缓存: <b>${info.supportsCaching ? '✓' : '✗'}</b></span>
    <span class="sep">|</span>
    <span class="item">输入: <b>${fmt(p.input)}</b></span>
    <span class="item">补全: <b>${fmt(p.output)}</b></span>
    <span class="item">缓存写: <b>${fmt(p.cacheWrite)}</b></span>
    <span class="item">缓存读: <b>${fmt(p.cacheRead)}</b></span>
    <span class="item unit">$/1M</span>`;
  bar.classList.remove('hidden');
}

// ── Render test cards ──
function renderTestCards() {
  const grid = document.getElementById('testGrid');
  grid.innerHTML = '';
  TESTS.forEach(t => {
    const card = document.createElement('div');
    card.className = 'test-card';
    card.id = `test-card-${t.id}`;
    card.innerHTML = `
      <div class="test-header" onclick="toggleTestBody('${t.id}')">
        <div class="left">
          <span class="badge badge-idle" id="badge-${t.id}">待测</span>
          <span class="name">${t.name}</span>
          <span class="duration" id="dur-${t.id}"></span>
        </div>
        <button class="btn btn-sm btn-primary" id="btn-${t.id}" onclick="event.stopPropagation();runTest('${t.id}')">运行</button>
      </div>
      <div class="test-body" id="body-${t.id}">
        <div class="tabs" id="tabs-${t.id}">
          <div class="tab active" onclick="switchTab('${t.id}','conclusion',event)">结论</div>
          <div class="tab" onclick="switchTab('${t.id}','request',event)">请求</div>
          <div class="tab" onclick="switchTab('${t.id}','response',event)">响应</div>
          <div class="tab" onclick="switchTab('${t.id}','judgment',event)">判断依据</div>
        </div>
        <div class="tab-content active" id="tc-${t.id}-conclusion">
          <div class="conclusion" id="conclusion-${t.id}">
            <span style="color:var(--text2)">点击"运行"执行此测试</span>
          </div>
        </div>
        <div class="tab-content" id="tc-${t.id}-request">
          <div style="text-align:right;margin-bottom:4px;"><button class="btn btn-sm" onclick="copyRaw('raw-req-${t.id}')">复制</button></div>
          <div class="raw-block" id="raw-req-${t.id}">暂无数据</div>
        </div>
        <div class="tab-content" id="tc-${t.id}-response">
          <div style="text-align:right;margin-bottom:4px;"><button class="btn btn-sm" onclick="copyRaw('raw-resp-${t.id}')">复制</button></div>
          <div class="raw-block" id="raw-resp-${t.id}">暂无数据</div>
        </div>
        <div class="tab-content" id="tc-${t.id}-judgment">
          <div class="conclusion" id="judgment-${t.id}">
            <span style="color:var(--text2)">暂无判断依据</span>
          </div>
        </div>
      </div>`;
    grid.appendChild(card);
  });
}

function toggleTestBody(testId) {
  document.getElementById(`body-${testId}`).classList.toggle('open');
}

function switchTab(testId, tabName, e) {
  // Update tab buttons
  document.querySelectorAll(`#tabs-${testId} .tab`).forEach(el => el.classList.remove('active'));
  if (e && e.target) e.target.classList.add('active');
  // Update content
  ['conclusion','request','response','judgment'].forEach(n => {
    document.getElementById(`tc-${testId}-${n}`).classList.remove('active');
  });
  document.getElementById(`tc-${testId}-${tabName}`).classList.add('active');
}

// ── Button lock management ──
let isRunningAll = false;

function setTestButtonsDisabled(disabled) {
  TESTS.forEach(t => { document.getElementById(`btn-${t.id}`).disabled = disabled; });
  document.getElementById('runAllBtn').disabled = disabled;
}

function markTestRunning(testId) {
  const badge = document.getElementById(`badge-${testId}`);
  badge.className = 'badge badge-running';
  badge.innerHTML = '<span class="spinner"></span> 运行中';
  document.getElementById(`dur-${testId}`).textContent = '';
  document.getElementById(`conclusion-${testId}`).innerHTML = '<span class="spinner"></span> 测试中...';
  // Reset tabs to conclusion
  const tabs = document.querySelectorAll(`#tabs-${testId} .tab`);
  tabs.forEach((t,i) => t.classList.toggle('active', i === 0));
  ['conclusion','request','response','judgment'].forEach((n,i) => {
    document.getElementById(`tc-${testId}-${n}`).classList.toggle('active', i === 0);
  });
}

// ── Execute a single test, returns a Promise that resolves with the result ──
function executeTest(testId, cfg) {
  return new Promise((resolve) => {
    markTestRunning(testId);
    const params = new URLSearchParams({ ...cfg, testId });
    const es = new EventSource(`/api/run-test?${params}`);

    es.addEventListener('result', e => {
      const r = JSON.parse(e.data);
      testResults[testId] = r;
      displayResult(testId, r);
      es.close();
      updateSummary();
      resolve(r);
    });

    es.addEventListener('error', e => {
      const badge = document.getElementById(`badge-${testId}`);
      try {
        const d = JSON.parse(e.data);
        badge.className = 'badge badge-error';
        badge.textContent = '错误';
        document.getElementById(`conclusion-${testId}`).innerHTML = `<span style="color:var(--red)">${esc(d.message)}</span>`;
      } catch {
        badge.className = 'badge badge-error';
        badge.textContent = '错误';
      }
      es.close();
      resolve(null);
    });

    es.onerror = () => { es.close(); resolve(null); };
  });
}

// ── Run a single test (user clicks individual Run button) ──
async function runTest(testId) {
  const cfg = getConfig();
  if (!cfg) return;

  const btn = document.getElementById(`btn-${testId}`);
  btn.disabled = true;
  document.getElementById('runAllBtn').disabled = true;
  document.getElementById(`body-${testId}`).classList.add('open');

  await executeTest(testId, cfg);

  btn.disabled = false;
  document.getElementById('runAllBtn').disabled = false;
}

// ── Run all tests sequentially, concurrency last ──
async function runAllTests() {
  const cfg = getConfig();
  if (!cfg) return;

  isRunningAll = true;
  setTestButtonsDisabled(true);
  document.getElementById('runAllBtn').textContent = '测试中...';

  const isStreaming = document.getElementById('useStreaming').checked;
  // Skip streaming test when streaming mode is on; concurrency runs last
  const skipIds = new Set(['concurrency']);
  if (isStreaming) skipIds.add('streaming');
  const normalTests = TESTS.filter(t => !skipIds.has(t.id));
  const concurrencyTest = TESTS.find(t => t.id === 'concurrency');

  for (const t of normalTests) {
    const r = await executeTest(t.id, cfg);
    if (r && r.message && r.message.toLowerCase().includes('quota')) {
      break;
    }
  }

  // Run concurrency test last
  if (concurrencyTest) {
    await executeTest(concurrencyTest.id, cfg);
  }

  isRunningAll = false;
  setTestButtonsDisabled(false);
  document.getElementById('runAllBtn').textContent = '全部测试';
}

// ── Display result ──
function displayResult(testId, r) {
  const badge = document.getElementById(`badge-${testId}`);
  badge.className = `badge badge-${r.status}`;
  badge.textContent = { pass:'通过', fail:'失败', warn:'警告', skip:'跳过', error:'错误' }[r.status] || r.status;

  const cost = calcCost(r);
  const durEl = document.getElementById(`dur-${testId}`);
  durEl.innerHTML = cost
    ? `${r.durationMs}ms <span class="cost-tag" title="${formatCostLine(cost)}">$${cost.total < 0.0001 ? cost.total.toExponential(2) : cost.total.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}</span>`
    : `${r.durationMs}ms`;

  // Conclusion tab
  const statusColor = { pass:'var(--green)', fail:'var(--red)', warn:'var(--yellow)', error:'var(--red)', skip:'var(--gray)' }[r.status];
  document.getElementById(`conclusion-${testId}`).innerHTML = `
    <div class="status-line" style="color:${statusColor}">${esc(r.message)}</div>
    ${r.details ? `<pre style="margin-top:8px;font-size:12px;color:var(--text2);white-space:pre-wrap">${esc(JSON.stringify(r.details, null, 2))}</pre>` : ''}`;

  // Request tab
  document.getElementById(`raw-req-${testId}`).textContent = r.rawRequest
    ? JSON.stringify(r.rawRequest, null, 2)
    : '未捕获到请求数据';

  // Response tab
  document.getElementById(`raw-resp-${testId}`).textContent = r.rawResponse
    ? JSON.stringify(r.rawResponse, null, 2)
    : '未捕获到响应数据';

  // Judgment tab
  document.getElementById(`judgment-${testId}`).innerHTML = r.judgment
    ? `<div class="judgment">${esc(r.judgment)}</div>`
    : '<span style="color:var(--text2)">未提供判断依据</span>';
}

// ── Summary ──
function updateSummary() {
  const card = document.getElementById('summaryCard');
  const results = Object.values(testResults);
  if (results.length === 0) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const counts = { total: results.length, pass: 0, fail: 0, warn: 0, skip: 0, error: 0 };
  results.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });

  let totalCost = 0;
  results.forEach(r => { const c = calcCost(r); if (c) totalCost += c.total; });
  const costStr = totalCost > 0 ? `$${totalCost < 0.001 ? totalCost.toExponential(2) : totalCost.toFixed(4)}` : '-';

  const s = calcScore(results);
  const gradeColor = { A: 'var(--green)', B: '#2da44e', C: 'var(--yellow)', D: '#cf6600', F: 'var(--red)' }[s.grade] || 'var(--text)';
  const bd = s.breakdown;
  const scoreTooltip = `通过率:${bd.passRate}/30  延迟:${bd.latency}/20  稳定性:${bd.stability}/20  并发:${bd.concurrency}/15  身份:${bd.identity}/15`;

  document.getElementById('summaryBar').innerHTML = `
    <div class="stat score-stat" title="${scoreTooltip}">
      <div class="num" style="color:${gradeColor}">${s.score}</div>
      <div class="lbl">评分 <span class="grade-badge" style="background:${gradeColor}">${s.grade}</span></div>
    </div>
    <div class="stat"><div class="num">${counts.total}</div><div class="lbl">总计</div></div>
    <div class="stat"><div class="num" style="color:var(--green)">${counts.pass}</div><div class="lbl">通过</div></div>
    <div class="stat"><div class="num" style="color:var(--red)">${counts.fail}</div><div class="lbl">失败</div></div>
    <div class="stat"><div class="num" style="color:var(--yellow)">${counts.warn}</div><div class="lbl">警告</div></div>
    <div class="stat"><div class="num" style="color:var(--gray)">${counts.skip}</div><div class="lbl">跳过</div></div>
    <div class="stat"><div class="num" style="color:var(--red)">${counts.error}</div><div class="lbl">错误</div></div>
    <div class="stat"><div class="num" style="color:var(--accent)">${costStr}</div><div class="lbl">估算费用</div></div>`;
}

// ── Custom request toggle ──
function toggleCustomBody() {
  const body = document.getElementById('customBody');
  const hint = document.getElementById('customToggleHint');
  body.classList.toggle('open');
  const isOpen = body.classList.contains('open');
  hint.textContent = isOpen ? '收起 ▲' : '展开 ▼';
}

// ── Streaming test visibility ──
function updateStreamingTestVisibility() {
  const isStreaming = document.getElementById('useStreaming').checked;
  const card = document.getElementById('test-card-streaming');
  if (card) card.style.display = isStreaming ? 'none' : '';
}

// ── Claude Code CLI option visibility ──
function updateClaudeCodeOption() {
  const modelId = document.getElementById('modelId').value.trim().toLowerCase();
  let provider = document.getElementById('provider').value;
  if (!provider) {
    if (modelId.includes('claude')) provider = 'claude';
    else if (modelId.includes('gemini')) provider = 'gemini';
    else provider = 'openai';
  }
  const el = document.getElementById('claudeCodeCLIOption');
  if (provider === 'claude') {
    el.style.display = '';
    el.classList.remove('hidden');
  } else {
    el.style.display = 'none';
    el.classList.add('hidden');
    document.getElementById('simulateClaudeCodeCLI').checked = false;
  }
}

// ── Utils ──
function getConfig() {
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const modelId = document.getElementById('modelId').value.trim();
  const apiKey = document.getElementById('apiKey').value.trim();
  let provider = document.getElementById('provider').value;
  if (!baseUrl || !modelId || !apiKey) { alert('请填写基础地址、模型 ID 和 API 密钥'); return null; }
  if (!provider) {
    const l = modelId.toLowerCase();
    provider = l.includes('claude') ? 'claude' : l.includes('gemini') ? 'gemini' : 'openai';
  }
  const cfg = { baseUrl, modelId, apiKey, provider };
  if (provider === 'claude' && document.getElementById('simulateClaudeCodeCLI').checked) {
    cfg.simulateClaudeCodeCLI = 'true';
  }
  if (document.getElementById('useStreaming').checked) {
    cfg.useStreaming = 'true';
  }
  return cfg;
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Cost estimation ──
function extractTokens(r) {
  const d = r.details || {};
  const usage = r.rawResponse?.body?.usage;
  const input = d.promptTokens ?? d.inputTokens ?? usage?.prompt_tokens ?? usage?.input_tokens ?? null;
  const output = d.completionTokens ?? d.outputTokens ?? usage?.completion_tokens ?? usage?.output_tokens ?? null;
  return { input, output };
}

function calcCost(r) {
  if (!currentPricing) return null;
  const t = extractTokens(r);
  if (t.input == null && t.output == null) return null;
  const inTok = t.input || 0;
  const outTok = t.output || 0;
  const inCost = inTok * currentPricing.input / 1e6;
  const outCost = outTok * currentPricing.output / 1e6;
  const total = inCost + outCost;
  return { inTok, outTok, inPrice: currentPricing.input, outPrice: currentPricing.output, inCost, outCost, total };
}

function formatCostLine(c) {
  if (!c) return '';
  const fmt = (v) => v < 0.0001 ? v.toExponential(2) : v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${c.inTok}x$${c.inPrice}/1M + ${c.outTok}x$${c.outPrice}/1M = $${fmt(c.total)}`;
}

// ── Scoring ──
function calcScore(results) {
  const byId = {};
  results.forEach(r => { byId[r.testId] = r; });
  const total = results.length;
  if (total === 0) return { score: 0, grade: 'F', breakdown: {} };

  // 1. Pass rate (30 pts)
  let passScore = 0;
  results.forEach(r => {
    if (r.status === 'pass') passScore += 30 / total;
    else if (r.status === 'warn') passScore += 15 / total;
  });

  // 2. Latency (20 pts) — from latency test TTFB
  let latencyScore = 0;
  const lat = byId['latency'];
  if (lat && lat.status !== 'skip' && lat.status !== 'error') {
    const ttfb = lat.details?.ttfbMs ?? lat.durationMs;
    if (ttfb < 1000) latencyScore = 20;
    else if (ttfb < 3000) latencyScore = 15;
    else if (ttfb < 10000) latencyScore = 8;
  }

  // 3. Stability (20 pts) — from stability test success rate
  let stabilityScore = 0;
  const stab = byId['stability'];
  if (stab && stab.details?.successRate != null) {
    stabilityScore = (stab.details.successRate / 100) * 20;
  } else if (stab && stab.status === 'pass') {
    stabilityScore = 20;
  }

  // 4. Concurrency (15 pts) — maxConcurrency / 30, capped
  let concurrencyScore = 0;
  const conc = byId['concurrency'];
  if (conc && conc.details?.maxConcurrency != null) {
    concurrencyScore = Math.min(conc.details.maxConcurrency / 30, 1) * 15;
  } else if (conc && conc.status === 'pass') {
    concurrencyScore = 15;
  }

  // 5. Identity (15 pts)
  let identityScore = 0;
  const ident = byId['identity'];
  if (ident) {
    if (ident.status === 'pass') identityScore = 15;
    else if (ident.status === 'warn') identityScore = 8;
  }

  const score = Math.round(passScore + latencyScore + stabilityScore + concurrencyScore + identityScore);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
  return {
    score, grade,
    breakdown: {
      passRate: Math.round(passScore),
      latency: Math.round(latencyScore),
      stability: Math.round(stabilityScore),
      concurrency: Math.round(concurrencyScore),
      identity: Math.round(identityScore),
    },
  };
}

// ── Custom Request ──
function generateCustomJSON() {
  const modelId = document.getElementById('modelId').value.trim() || 'model-id';
  let provider = document.getElementById('provider').value;
  if (!provider) {
    const l = modelId.toLowerCase();
    provider = l.includes('claude') ? 'claude' : l.includes('gemini') ? 'gemini' : 'openai';
  }

  let json;
  if (provider === 'claude') {
    json = {
      model: modelId,
      max_tokens: 1024,
      messages: [{ role: 'user', content: '你好，请做一下自我介绍' }],
    };
  } else if (provider === 'gemini') {
    json = {
      contents: [{ parts: [{ text: '你好，请做一下自我介绍' }] }],
      generationConfig: { maxOutputTokens: 1024 },
    };
  } else {
    json = {
      model: modelId,
      max_tokens: 1024,
      messages: [{ role: 'user', content: '你好，请做一下自我介绍' }],
    };
  }
  const ta = document.getElementById('customJSON');
  ta.value = JSON.stringify(json, null, 2);

  // Visual feedback so regeneration is visible even when content is unchanged
  ta.style.transition = 'background 0.15s';
  ta.style.background = '#ddf4ff';
  setTimeout(() => { ta.style.background = ''; }, 300);
}

function switchCustomTab(tab) {
  const resp = document.getElementById('customRespContent');
  const raw = document.getElementById('customRawContent');
  const tabResp = document.getElementById('customTabResp');
  const tabRaw = document.getElementById('customTabRaw');
  if (tab === 'resp') {
    resp.style.display = ''; raw.style.display = 'none';
    tabResp.style.fontWeight = '500'; tabRaw.style.fontWeight = '';
  } else {
    resp.style.display = 'none'; raw.style.display = '';
    tabResp.style.fontWeight = ''; tabRaw.style.fontWeight = '500';
  }
}

function copyCustomResult() {
  const resp = document.getElementById('customRespContent');
  const raw = document.getElementById('customRawContent');
  const visible = resp.style.display !== 'none' ? resp : raw;
  navigator.clipboard.writeText(visible.textContent).then(() => {});
}

async function sendCustomRequest() {
  const cfg = getConfig();
  if (!cfg) return;

  const btn = document.getElementById('customSendBtn');
  const badge = document.getElementById('customBadge');
  const dur = document.getElementById('customDur');
  btn.disabled = true;
  badge.style.display = '';
  badge.className = 'badge badge-running';
  badge.innerHTML = '<span class="spinner"></span> 请求中';
  dur.textContent = '';

  // Auto-expand and scroll into view like test items
  const body = document.getElementById('customBody');
  const hint = document.getElementById('customToggleHint');
  body.classList.add('open');
  hint.textContent = '收起 ▲';
  body.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const jsonStr = document.getElementById('customJSON').value.trim();
  const params = new URLSearchParams({ ...cfg, testId: 'custom', customPrompt: jsonStr });
  const es = new EventSource(`/api/run-test?${params}`);

  es.addEventListener('result', e => {
    const r = JSON.parse(e.data);
    dur.textContent = `${r.durationMs}ms`;
    badge.className = `badge badge-${r.status}`;
    badge.textContent = { pass:'成功', fail:'失败', warn:'警告', skip:'跳过', error:'错误' }[r.status] || r.status;

    const resultDiv = document.getElementById('customResult');
    resultDiv.style.display = '';

    const respContent = document.getElementById('customRespContent');
    respContent.textContent = r.details?.response || r.message || '无内容';

    const rawContent = document.getElementById('customRawContent');
    rawContent.textContent = r.rawResponse ? JSON.stringify(r.rawResponse, null, 2) : '无原始数据';

    switchCustomTab('resp');
    es.close();
    btn.disabled = false;
  });

  es.addEventListener('error', e => {
    try {
      const d = JSON.parse(e.data);
      badge.className = 'badge badge-error';
      badge.textContent = '错误';
      document.getElementById('customResult').style.display = '';
      document.getElementById('customRespContent').textContent = d.message;
    } catch {}
    es.close();
    btn.disabled = false;
  });

  es.onerror = () => { es.close(); btn.disabled = false; };
}

function copyRaw(id) {
  const el = document.getElementById(id);
  const text = el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = el.parentElement.querySelector('.btn');
    if (btn) { const orig = btn.textContent; btn.textContent = '已复制'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}

// ── IndexedDB persistence ──
const DB_NAME = 'apitest_history';
const DB_VERSION = 1;
const STORE_NAME = 'results';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToHistory() {
  const results = Object.values(testResults);
  if (results.length === 0) return;
  const s = calcScore(results);
  const counts = { total: results.length, pass: 0, fail: 0, warn: 0, skip: 0, error: 0 };
  results.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
  let totalCost = 0;
  results.forEach(r => { const c = calcCost(r); if (c) totalCost += c.total; });

  const record = {
    timestamp: new Date().toISOString(),
    baseUrl: document.getElementById('baseUrl').value.trim(),
    modelId: document.getElementById('modelId').value.trim(),
    provider: document.getElementById('provider').value,
    results: results,
    summary: counts,
    score: s.score,
    grade: s.grade,
    totalCost,
  };
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add(record);
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; });
  loadHistory();
}

async function loadHistory() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const list = document.getElementById('historyList');
      renderTrendChart(records);
      if (records.length === 0) { list.innerHTML = '暂无历史记录'; return; }
      list.innerHTML = records.map(r => {
        const time = new Date(r.timestamp).toLocaleString('zh-CN');
        const gradeColor = { A:'var(--green)', B:'#2da44e', C:'var(--yellow)', D:'#cf6600', F:'var(--red)' }[r.grade] || 'var(--text)';
        const url = new URL(r.baseUrl).hostname;
        return `<div class="history-item">
          <span class="history-score" style="color:${gradeColor}">${r.score}<small>${r.grade}</small></span>
          <span class="history-info"><b>${r.modelId}</b> @ ${url}</span>
          <span class="history-stats">${r.summary.pass}/${r.summary.total} 通过</span>
          <span class="history-time">${time}</span>
          <button class="btn btn-sm" onclick="deleteHistoryItem(${r.id})">删除</button>
        </div>`;
      }).join('');
    };
  } catch {}
}

async function deleteHistoryItem(id) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  tx.oncomplete = () => loadHistory();
}

async function clearHistory() {
  if (!confirm('确定要清空所有历史记录吗？')) return;
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  tx.oncomplete = () => loadHistory();
}

// ── Trend chart ──
let trendChart = null;

function renderTrendChart(records) {
  const chartEl = document.getElementById('historyChart');
  if (!records || records.length < 2) { chartEl.style.display = 'none'; return; }
  chartEl.style.display = '';

  // Group by baseUrl+modelId, take last 20
  const sorted = [...records].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).slice(-20);
  const groups = {};
  sorted.forEach(r => {
    const key = `${r.modelId}@${new URL(r.baseUrl).hostname}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const colors = ['#0969da', '#1a7f37', '#cf222e', '#9a6700', '#6639ba'];
  const datasets = Object.entries(groups).map(([key, recs], i) => ({
    label: key,
    data: recs.map(r => ({ x: r.timestamp, y: r.score })),
    borderColor: colors[i % colors.length],
    backgroundColor: colors[i % colors.length] + '20',
    tension: 0.3,
    pointRadius: 4,
  }));

  const ctx = document.getElementById('trendCanvas');
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 } } } },
      scales: {
        x: { type: 'category', labels: sorted.map(r => new Date(r.timestamp).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })), ticks: { font: { size: 10 } } },
        y: { min: 0, max: 100, title: { display: true, text: '评分' }, ticks: { font: { size: 10 } } },
      },
    },
  });
}

// ── Export ──
function exportJSON() {
  const results = Object.values(testResults);
  if (results.length === 0) { alert('无测试结果可导出'); return; }
  const s = calcScore(results);
  const data = {
    exportTime: new Date().toISOString(),
    baseUrl: document.getElementById('baseUrl').value.trim(),
    modelId: document.getElementById('modelId').value.trim(),
    provider: document.getElementById('provider').value,
    score: s.score,
    grade: s.grade,
    scoreBreakdown: s.breakdown,
    results,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `apitest-${data.modelId}-${Date.now()}.json`;
  a.click();
}

function exportHTMLReport() {
  const results = Object.values(testResults);
  if (results.length === 0) { alert('无测试结果可导出'); return; }
  const s = calcScore(results);
  const modelId = document.getElementById('modelId').value.trim();
  const baseUrl = document.getElementById('baseUrl').value.trim();
  const provider = document.getElementById('provider').value;
  const bd = s.breakdown;
  const gradeColor = { A:'#1a7f37', B:'#2da44e', C:'#9a6700', D:'#cf6600', F:'#cf222e' }[s.grade];

  let totalCost = 0;
  results.forEach(r => { const c = calcCost(r); if (c) totalCost += c.total; });

  const statusMap = { pass:'通过', fail:'失败', warn:'警告', skip:'跳过', error:'错误' };
  const statusColors = { pass:'#1a7f37', fail:'#cf222e', warn:'#9a6700', skip:'#6e7781', error:'#cf222e' };

  const rows = results.map(r => {
    const c = calcCost(r);
    const costStr = c ? `$${c.total.toFixed(6)}` : '-';
    return `<tr>
      <td>${esc(r.testName)}</td>
      <td style="color:${statusColors[r.status]};font-weight:600">${statusMap[r.status] || r.status}</td>
      <td>${r.durationMs}ms</td>
      <td>${costStr}</td>
      <td style="font-size:12px">${esc(r.message)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<title>测试报告 - ${esc(modelId)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1f2328}
h1{font-size:20px;margin-bottom:4px}
.meta{color:#656d76;font-size:13px;margin-bottom:24px}
.score-box{display:inline-flex;align-items:center;gap:12px;padding:16px 24px;background:#f5f6f8;border-radius:12px;margin-bottom:24px}
.score-num{font-size:48px;font-weight:700;color:${gradeColor}}
.score-grade{font-size:24px;font-weight:700;color:#fff;background:${gradeColor};padding:4px 12px;border-radius:8px}
.breakdown{display:flex;gap:16px;font-size:12px;color:#656d76;margin-top:8px}
.breakdown span b{color:#1f2328}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
th,td{padding:8px 12px;border:1px solid #e1e4e8;text-align:left}
th{background:#f5f6f8;font-weight:600}
.footer{margin-top:24px;padding-top:16px;border-top:1px solid #e1e4e8;font-size:11px;color:#656d76}
</style></head><body>
<h1>API 通道测试报告</h1>
<div class="meta">模型: ${esc(modelId)} | 通道: ${esc(baseUrl)} | 服务商: ${esc(provider)} | 时间: ${new Date().toLocaleString('zh-CN')}</div>
<div class="score-box">
  <span class="score-num">${s.score}</span>
  <span class="score-grade">${s.grade}</span>
  <div>
    <div class="breakdown">
      <span>通过率: <b>${bd.passRate}/30</b></span>
      <span>延迟: <b>${bd.latency}/20</b></span>
      <span>稳定性: <b>${bd.stability}/20</b></span>
      <span>并发: <b>${bd.concurrency}/15</b></span>
      <span>身份: <b>${bd.identity}/15</b></span>
    </div>
    <div style="font-size:12px;color:#656d76;margin-top:4px">总估算费用: $${totalCost.toFixed(6)}</div>
  </div>
</div>
<table><thead><tr><th>测试项</th><th>状态</th><th>耗时</th><th>费用</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">由模型中转测试工具生成 | ${new Date().toISOString()}</div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report-${modelId}-${Date.now()}.html`;
  a.click();
}

// ── Multi-relay compare ──
let compareRowCount = 0;

function addCompareRow(url, key) {
  const container = document.getElementById('compareRows');
  if (container.children.length >= 5) return;
  const idx = compareRowCount++;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;align-items:center;';
  row.id = `compare-row-${idx}`;
  row.innerHTML =
    `<span style="font-size:12px;color:var(--text2);min-width:16px;">${container.children.length + 1}</span>` +
    `<input type="text" class="compare-url" placeholder="https://api.example.com" value="${url || ''}" style="flex:2;font-size:12px;">` +
    `<input type="password" class="compare-key" placeholder="密钥（可选）" value="${key || ''}" style="flex:1;font-size:12px;">` +
    `<button class="btn btn-sm" onclick="removeCompareRow('compare-row-${idx}')" style="padding:2px 8px;color:var(--red);">✕</button>`;
  container.appendChild(row);
  updateCompareRowNumbers();
  updateAddBtn();
}

function removeCompareRow(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  updateCompareRowNumbers();
  updateAddBtn();
}

function updateCompareRowNumbers() {
  const rows = document.getElementById('compareRows').children;
  for (let i = 0; i < rows.length; i++) {
    rows[i].querySelector('span').textContent = i + 1;
  }
}

function updateAddBtn() {
  const btn = document.getElementById('addCompareRowBtn');
  btn.disabled = document.getElementById('compareRows').children.length >= 5;
}

function getCompareEntries() {
  const rows = document.getElementById('compareRows').children;
  const entries = [];
  for (const row of rows) {
    const url = row.querySelector('.compare-url').value.trim().replace(/\/+$/, '');
    const key = row.querySelector('.compare-key').value.trim();
    if (url) entries.push({ url, key });
  }
  return entries;
}

function toggleCompareBody() {
  const body = document.getElementById('compareBody');
  const hint = document.getElementById('compareToggleHint');
  body.classList.toggle('open');
  hint.textContent = body.classList.contains('open') ? '收起 ▲' : '展开 ▼';
}

function renderCompareChecks() {
  const container = document.getElementById('compareTestChecks');
  const defaultOn = ['promptInjection', 'identity', 'fingerprint', 'latency', 'stability'];
  container.innerHTML = TESTS.map(t =>
    `<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
      <input type="checkbox" class="compare-check" value="${t.id}" ${defaultOn.includes(t.id) ? 'checked' : ''} style="width:auto;accent-color:var(--accent);">
      ${t.name}
    </label>`
  ).join('');
}

function toggleCompareChecks(checked) {
  document.querySelectorAll('.compare-check').forEach(el => el.checked = checked);
}

async function runCompare() {
  const modelId = document.getElementById('modelId').value.trim();
  const globalApiKey = document.getElementById('apiKey').value.trim();
  let provider = document.getElementById('provider').value;
  if (!modelId) { alert('请先填写模型 ID'); return; }
  if (!provider) {
    const l = modelId.toLowerCase();
    provider = l.includes('claude') ? 'claude' : l.includes('gemini') ? 'gemini' : 'openai';
  }

  const entries = getCompareEntries();
  if (entries.length < 2) { alert('请至少输入 2 个中转地址'); return; }

  const needGlobal = entries.some(e => !e.key);
  if (needGlobal && !globalApiKey) { alert('部分地址未指定密钥，请填写上方全局 API 密钥作为默认值'); return; }

  const btn = document.getElementById('compareBtn');
  btn.disabled = true;
  btn.textContent = '对比中...';
  const resultDiv = document.getElementById('compareResult');
  resultDiv.style.display = '';
  resultDiv.innerHTML = '<span class="spinner"></span> 正在对比测试中，请稍候...';

  // Run selected tests on each URL
  const testIds = [...document.querySelectorAll('.compare-check:checked')].map(el => el.value);
  if (testIds.length === 0) { alert('请至少选择一项测试'); btn.disabled = false; btn.textContent = '开始对比'; return; }
  const allResults = {};

  for (const entry of entries) {
    allResults[entry.url] = {};
    const apiKey = entry.key || globalApiKey;
    const cfg = { baseUrl: entry.url, modelId, apiKey, provider };
    if (document.getElementById('useStreaming').checked) cfg.useStreaming = 'true';

    for (const testId of testIds) {
      try {
        const result = await new Promise((resolve) => {
          const params = new URLSearchParams({ ...cfg, testId });
          const es = new EventSource(`/api/run-test?${params}`);
          es.addEventListener('result', e => { resolve(JSON.parse(e.data)); es.close(); });
          es.addEventListener('error', () => { resolve(null); es.close(); });
          es.onerror = () => { resolve(null); es.close(); };
        });
        allResults[entry.url][testId] = result;
      } catch { allResults[entry.url][testId] = null; }
    }
  }

  // Render comparison table
  const statusMap = { pass:'通过', fail:'失败', warn:'警告', skip:'跳过', error:'错误' };
  const statusColors = { pass:'var(--green)', fail:'var(--red)', warn:'var(--yellow)', skip:'var(--gray)', error:'var(--red)' };
  const testNameMap = {};
  TESTS.forEach(t => { testNameMap[t.id] = t.name; });

  const urls = entries.map(e => e.url);
  const headerCells = urls.map(u => `<th>${new URL(u).hostname}</th>`).join('');
  const rows = testIds.map(tid => {
    const cells = urls.map(u => {
      const r = allResults[u][tid];
      if (!r) return '<td style="color:var(--gray)">-</td>';
      const extra = tid === 'latency' && r.details?.ttfbMs ? ` (${r.details.ttfbMs}ms)` : '';
      return `<td style="color:${statusColors[r.status]}">${statusMap[r.status]}${extra}</td>`;
    }).join('');
    return `<tr><td><b>${testNameMap[tid] || tid}</b></td>${cells}</tr>`;
  }).join('');

  // Score row
  const scoreRow = urls.map(u => {
    const results = Object.values(allResults[u]).filter(Boolean);
    const s = calcScore(results);
    const gradeColor = { A:'var(--green)', B:'#2da44e', C:'var(--yellow)', D:'#cf6600', F:'var(--red)' }[s.grade];
    return `<td style="font-weight:700;color:${gradeColor}">${s.score} (${s.grade})</td>`;
  }).join('');

  resultDiv.innerHTML = `<table class="compare-table"><thead><tr><th>测试项</th>${headerCells}</tr></thead><tbody>${rows}<tr><td><b>评分</b></td>${scoreRow}</tr></tbody></table>`;

  btn.disabled = false;
  btn.textContent = '开始对比';
}

// ── Auto-save after all tests ──
const _origRunAllTests = runAllTests;
runAllTests = async function() {
  await _origRunAllTests();
  await saveToHistory();
};

init();
loadHistory();
