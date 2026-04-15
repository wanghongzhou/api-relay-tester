// ── State ──
let TESTS = [];
let testResults = {};

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
    bar.className = 'model-bar unknown';
    bar.innerHTML = '<span>该模型不在官方数据库中。身份验证和上下文长度测试的比对能力将受到限制。</span>';
    bar.classList.remove('hidden');
    return;
  }
  bar.className = 'model-bar';
  bar.innerHTML = `
    <span class="item"><b>${info.displayName}</b></span>
    <span class="item">上下文: <b>${(info.contextWindow/1000).toFixed(0)}K</b></span>
    <span class="item">知识截止: <b>${info.knowledgeCutoff}</b></span>
    <span class="item">思维链: <b>${info.supportsThinking ? '支持' : '不支持'}</b></span>
    <span class="item">缓存: <b>${info.supportsCaching ? '支持' : '不支持'}</b></span>`;
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
          <div class="tab active" onclick="switchTab('${t.id}','conclusion')">结论</div>
          <div class="tab" onclick="switchTab('${t.id}','request')">请求</div>
          <div class="tab" onclick="switchTab('${t.id}','response')">响应</div>
          <div class="tab" onclick="switchTab('${t.id}','judgment')">判断依据</div>
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

function switchTab(testId, tabName) {
  // Update tab buttons
  document.querySelectorAll(`#tabs-${testId} .tab`).forEach(el => el.classList.remove('active'));
  event.target.classList.add('active');
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

  document.getElementById(`dur-${testId}`).textContent = `${r.durationMs}ms`;

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

  document.getElementById('summaryBar').innerHTML = `
    <div class="stat"><div class="num">${counts.total}</div><div class="lbl">总计</div></div>
    <div class="stat"><div class="num" style="color:var(--green)">${counts.pass}</div><div class="lbl">通过</div></div>
    <div class="stat"><div class="num" style="color:var(--red)">${counts.fail}</div><div class="lbl">失败</div></div>
    <div class="stat"><div class="num" style="color:var(--yellow)">${counts.warn}</div><div class="lbl">警告</div></div>
    <div class="stat"><div class="num" style="color:var(--gray)">${counts.skip}</div><div class="lbl">跳过</div></div>
    <div class="stat"><div class="num" style="color:var(--red)">${counts.error}</div><div class="lbl">错误</div></div>`;
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
  document.getElementById('customJSON').value = JSON.stringify(json, null, 2);
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

init();
