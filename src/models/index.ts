import { ModelInfo } from '../types/index.js';

/**
 * Official model information — latest generations per provider (with open API).
 *
 * Sources:
 *   - Anthropic: https://platform.claude.com/docs/en/about-claude/models/overview
 *   - OpenAI:    https://developers.openai.com/api/docs/models
 *   - Google:    https://ai.google.dev/gemini-api/docs/models
 */
export const MODELS_DB: Record<string, ModelInfo> = {

  // ══════════════════════════════════════════════════════════════
  //  Anthropic — 4.6 (Opus / Sonnet) + 4.5 (Haiku)
  // ══════════════════════════════════════════════════════════════

  'claude-opus-4-6': {
    modelId: 'claude-opus-4-6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    contextWindow: 1000000,
    previousContextWindow: 200000,
    knowledgeCutoff: '2025-05',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '4.6',
    pricing: { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.50 },
  },
  'claude-sonnet-4-6': {
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 1000000,
    previousContextWindow: 200000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '4.6',
    pricing: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.30 },
  },
  'claude-haiku-4-5': {
    modelId: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200000,
    previousContextWindow: 200000,
    knowledgeCutoff: '2025-02',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '4.5',
    pricing: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.10 },
  },
  // ══════════════════════════════════════════════════════════════
  //  OpenAI — 5.4 + 5.3-codex  (5.2 及以下已于 2026-04-14 下架)
  // ══════════════════════════════════════════════════════════════

  'gpt-5.3-codex': {
    modelId: 'gpt-5.3-codex',
    provider: 'openai',
    displayName: 'GPT-5.3 Codex',
    contextWindow: 400000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.3',
    pricing: { input: 1.75, output: 14, cacheWrite: null, cacheRead: 0.175 },
  },
  'gpt-5.4': {
    modelId: 'gpt-5.4',
    provider: 'openai',
    displayName: 'GPT-5.4',
    contextWindow: 1050000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.4',
    pricing: { input: 2.50, output: 15, cacheWrite: null, cacheRead: 0.25 },
  },
  'gpt-5.4-mini': {
    modelId: 'gpt-5.4-mini',
    provider: 'openai',
    displayName: 'GPT-5.4 Mini',
    contextWindow: 400000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.4',
    pricing: { input: 0.75, output: 4.50, cacheWrite: null, cacheRead: 0.075 },
  },
  'gpt-5.4-nano': {
    modelId: 'gpt-5.4-nano',
    provider: 'openai',
    displayName: 'GPT-5.4 Nano',
    contextWindow: 400000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.4',
    pricing: { input: 0.20, output: 1.25, cacheWrite: null, cacheRead: 0.02 },
  },
  'gpt-5.4-pro': {
    modelId: 'gpt-5.4-pro',
    provider: 'openai',
    displayName: 'GPT-5.4 Pro',
    contextWindow: 1050000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.4',
    pricing: { input: 30, output: 180, cacheWrite: null, cacheRead: 3 },
  },

  // ══════════════════════════════════════════════════════════════
  //  Google — 3.1 + 3.0 + 2.5
  // ══════════════════════════════════════════════════════════════

  'gemini-3.1-pro': {
    modelId: 'gemini-3.1-pro',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
    pricing: { input: 2, output: 12, cacheWrite: null, cacheRead: 0.20 },
  },
  'gemini-3.1-flash': {
    modelId: 'gemini-3.1-flash',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
    pricing: { input: 0.50, output: 3, cacheWrite: null, cacheRead: 0.05 },
  },
  'gemini-3.1-pro-preview': {
    modelId: 'gemini-3.1-pro-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
    pricing: { input: 2, output: 12, cacheWrite: null, cacheRead: 0.20 },
  },
  'gemini-3.1-flash-lite-preview': {
    modelId: 'gemini-3.1-flash-lite-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash-Lite Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
    pricing: { input: 0.25, output: 1.50, cacheWrite: null, cacheRead: 0.025 },
  },
  'gemini-3.1-flash-image-preview': {
    modelId: 'gemini-3.1-flash-image-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash Image Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: false,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
    pricing: { input: 0.50, output: 3, cacheWrite: null, cacheRead: 0.05 },
  },
  'gemini-3-pro-preview': {
    modelId: 'gemini-3-pro-preview',
    provider: 'google',
    displayName: 'Gemini 3 Pro Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.0',
    pricing: { input: 2, output: 12, cacheWrite: null, cacheRead: 0.20 },
  },
  'gemini-3-flash-preview': {
    modelId: 'gemini-3-flash-preview',
    provider: 'google',
    displayName: 'Gemini 3 Flash Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.0',
    pricing: { input: 0.50, output: 3, cacheWrite: null, cacheRead: 0.05 },
  },
  'gemini-2.5-pro': {
    modelId: 'gemini-2.5-pro',
    provider: 'google',
    displayName: 'Gemini 2.5 Pro',
    contextWindow: 1048576,
    previousContextWindow: 1000000,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '2.5',
    pricing: { input: 1.25, output: 10, cacheWrite: null, cacheRead: 0.125 },
  },
  'gemini-2.5-flash': {
    modelId: 'gemini-2.5-flash',
    provider: 'google',
    displayName: 'Gemini 2.5 Flash',
    contextWindow: 1048576,
    previousContextWindow: 1000000,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '2.5',
    pricing: { input: 0.30, output: 2.50, cacheWrite: null, cacheRead: 0.03 },
  },
};

export function getModelInfo(modelId: string): ModelInfo | undefined {
  if (MODELS_DB[modelId]) return MODELS_DB[modelId];
  const stripped = modelId.replace(/-\d{8}$/, '');
  if (MODELS_DB[stripped]) return MODELS_DB[stripped];
  const lower = modelId.toLowerCase();
  for (const [key, info] of Object.entries(MODELS_DB)) {
    if (lower.includes(key) || key.includes(lower)) return info;
  }
  return undefined;
}

export function listKnownModels(): Array<{ id: string; display: string; provider: string }> {
  return Object.values(MODELS_DB).map(m => ({
    id: m.modelId,
    display: `${m.displayName} (${m.provider})`,
    provider: m.provider,
  }));
}
