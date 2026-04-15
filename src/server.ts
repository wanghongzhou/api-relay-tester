#!/usr/bin/env tsx
/**
 * Web UI server for model testing tool.
 * - GET  /                  → HTML UI
 * - GET  /api/models        → list known models
 * - GET  /api/model-info    → get model info by id
 * - GET  /api/tests         → list available test IDs and names
 * - GET  /api/run-test      → run a SINGLE test (SSE stream)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestConfig } from './types.js';
import { getModelInfo, listKnownModels } from './models-info.js';
import { BaseTester } from './base-tester.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function createTester(config: TestConfig): Promise<BaseTester> {
  switch (config.provider) {
    case 'openai': { const { default: T } = await import('./openai-tester.js'); return new T(config); }
    case 'claude': { const { default: T } = await import('./claude-tester.js'); return new T(config); }
    case 'gemini': { const { default: T } = await import('./gemini-tester.js'); return new T(config); }
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// Cache tester instances per session (baseUrl+modelId+provider)
const testerCache = new Map<string, BaseTester>();

function getTesterKey(config: TestConfig) {
  return `${config.provider}:${config.modelId}:${config.baseUrl}:cli=${config.simulateClaudeCodeCLI ?? false}:stream=${config.useStreaming ?? false}`;
}

async function getOrCreateTester(config: TestConfig): Promise<BaseTester> {
  const key = getTesterKey(config);
  let tester = testerCache.get(key);
  if (!tester) {
    tester = await createTester(config);
    testerCache.set(key, tester);
  }
  return tester;
}

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3000', 10);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── List known models ──
  if (url.pathname === '/api/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(listKnownModels()));
    return;
  }

  // ── Get model info ──
  if (url.pathname === '/api/model-info') {
    const id = url.searchParams.get('id') ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getModelInfo(id) ?? null));
    return;
  }

  // ── List available tests ──
  if (url.pathname === '/api/tests') {
    const tests = BaseTester.TEST_IDS.map(id => ({
      id,
      name: BaseTester.TEST_NAMES[id],
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tests));
    return;
  }

  // ── Run a single test (SSE) ──
  if (url.pathname === '/api/run-test') {
    const baseUrl = (url.searchParams.get('baseUrl') ?? '').replace(/\/+$/, '');
    const modelId = url.searchParams.get('modelId') ?? '';
    const apiKey = url.searchParams.get('apiKey') ?? '';
    const provider = (url.searchParams.get('provider') ?? '') as TestConfig['provider'];
    const testId = url.searchParams.get('testId') ?? '';
    const simulateClaudeCodeCLI = url.searchParams.get('simulateClaudeCodeCLI') === 'true';
    const useStreaming = url.searchParams.get('useStreaming') === 'true';

    if (!baseUrl || !modelId || !apiKey || !provider || !testId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing params: baseUrl, modelId, apiKey, provider, testId' }));
      return;
    }

    // SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      send('started', { testId, testName: BaseTester.TEST_NAMES[testId] ?? testId });
      const customPrompt = url.searchParams.get('customPrompt') ?? '';
      const tester = await getOrCreateTester({ baseUrl, modelId, apiKey, provider, simulateClaudeCodeCLI, useStreaming });
      const result = await tester.runSingle(testId, { customPrompt });
      send('result', result);
    } catch (err: any) {
      send('error', { testId, message: err.message });
    }

    res.end();
    return;
  }

  // ── Serve HTML ──
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    try {
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('Cannot load index.html');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  模型测试工具 — Web 界面`);
  console.log(`  http://localhost:${PORT}\n`);
});
