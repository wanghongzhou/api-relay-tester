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
    previousContextWindow: 200000,   // Opus 4.5 was 200K
    knowledgeCutoff: '2025-05',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '4.6',
  },
  'claude-sonnet-4-6': {
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 1000000,
    previousContextWindow: 200000,   // Sonnet 4.5 was 200K
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: true,
    supportsStreaming: true,
    version: '4.6',
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
  },
  // ══════════════════════════════════════════════════════════════
  //  OpenAI — 5.4 + 5.3-codex + 5.2
  // ══════════════════════════════════════════════════════════════

  'gpt-5.2': {
    modelId: 'gpt-5.2',
    provider: 'openai',
    displayName: 'GPT-5.2',
    contextWindow: 400000,              // 400K max, 128K chat variant
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: none/low/medium/high/xhigh
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.2',
  },
  'gpt-5.2-codex': {
    modelId: 'gpt-5.2-codex',
    provider: 'openai',
    displayName: 'GPT-5.2 Codex',
    contextWindow: 400000,              // 400K + context compaction
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: low/medium/high/xhigh
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.2',
  },
  'gpt-5.2-pro': {
    modelId: 'gpt-5.2-pro',
    provider: 'openai',
    displayName: 'GPT-5.2 Pro',
    contextWindow: 400000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: xhigh
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.2',
  },
  'gpt-5.3-codex': {
    modelId: 'gpt-5.3-codex',
    provider: 'openai',
    displayName: 'GPT-5.3 Codex',
    contextWindow: 400000,              // 400K max
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: low/medium/high/xhigh
    supportsCaching: true,
    supportsStreaming: true,
    version: '5.3',
  },
  'gpt-5.4': {
    modelId: 'gpt-5.4',
    provider: 'openai',
    displayName: 'GPT-5.4',
    contextWindow: 1050000,             // 1.05M max, 272K standard
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,
    supportsCaching: false,
    supportsStreaming: true,
    version: '5.4',
  },
  'gpt-5.4-mini': {
    modelId: 'gpt-5.4-mini',
    provider: 'openai',
    displayName: 'GPT-5.4 Mini',
    contextWindow: 400000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: none/low/medium/high/xhigh
    supportsCaching: false,
    supportsStreaming: true,
    version: '5.4',
  },
  'gpt-5.4-nano': {
    modelId: 'gpt-5.4-nano',
    provider: 'openai',
    displayName: 'GPT-5.4 Nano',
    contextWindow: 400000,
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: none/low/medium/high/xhigh
    supportsCaching: false,
    supportsStreaming: true,
    version: '5.4',
  },
  'gpt-5.4-pro': {
    modelId: 'gpt-5.4-pro',
    provider: 'openai',
    displayName: 'GPT-5.4 Pro',
    contextWindow: 1050000,             // 1.05M max (922K input + 128K output)
    previousContextWindow: 128000,
    knowledgeCutoff: '2025-08',
    supportsThinking: true,             // reasoning: none/low/medium/high/xhigh
    supportsCaching: false,
    supportsStreaming: true,
    version: '5.4',
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
  },
  'gemini-3.1-flash-lite-preview': {
    modelId: 'gemini-3.1-flash-lite-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash-Lite Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,             // thinking: minimal/low/medium/high
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
  },
  'gemini-3.1-flash-image-preview': {
    modelId: 'gemini-3.1-flash-image-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash Image Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: false,            // image generation model
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.1',
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
  },
  'gemini-3-flash-preview': {
    modelId: 'gemini-3-flash-preview',
    provider: 'google',
    displayName: 'Gemini 3 Flash Preview',
    contextWindow: 1048576,
    previousContextWindow: 1048576,
    knowledgeCutoff: '2025-01',
    supportsThinking: true,             // thinking: minimal/low/medium/high
    supportsCaching: true,
    supportsStreaming: true,
    version: '3.0',
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
