import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestConfig } from '../types/index.js';
import { getModelInfo, listKnownModels } from '../models/index.js';
import { BaseTester, createTester } from '../testers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── List known models ──
app.get('/api/models', (_req, res) => {
  res.json(listKnownModels());
});

// ── Get model info ──
app.get('/api/model-info', (req, res) => {
  const id = (req.query.id as string) ?? '';
  res.json(getModelInfo(id) ?? null);
});

// ── List available tests ──
app.get('/api/tests', (_req, res) => {
  const tests = BaseTester.TEST_IDS.map(id => ({
    id,
    name: BaseTester.TEST_NAMES[id],
  }));
  res.json(tests);
});

// ── Run a single test (SSE) ──
app.get('/api/run-test', async (req, res) => {
  const baseUrl = ((req.query.baseUrl as string) ?? '').replace(/\/+$/, '');
  const modelId = (req.query.modelId as string) ?? '';
  const apiKey = (req.query.apiKey as string) ?? '';
  const provider = (req.query.provider as string ?? '') as TestConfig['provider'];
  const testId = (req.query.testId as string) ?? '';
  const simulateClaudeCodeCLI = req.query.simulateClaudeCodeCLI === 'true';
  const useStreaming = req.query.useStreaming === 'true';

  if (!baseUrl || !modelId || !apiKey || !provider || !testId) {
    res.status(400).json({ error: 'Missing params: baseUrl, modelId, apiKey, provider, testId' });
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
    const customPrompt = (req.query.customPrompt as string) ?? '';
    const tester = await getOrCreateTester({ baseUrl, modelId, apiKey, provider, simulateClaudeCodeCLI, useStreaming });
    const result = await tester.runSingle(testId, { customPrompt });
    send('result', result);
  } catch (err: any) {
    send('error', { testId, message: err.message });
  }

  res.end();
});
