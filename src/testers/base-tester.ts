import { TestConfig, TestResult, TestSuiteResult } from '../types/index.js';
import { getModelInfo } from '../models/index.js';
import {
  createTestResult,
  buildSuiteResult,
  printTestResult,
  printSuiteSummary,
  isQuotaError,
  sleep,
} from '../utils/index.js';

/** Captured HTTP exchange for display in the UI */
export interface RawExchange {
  request: { url: string; method: string; headers: Record<string, string>; body: any };
  response: { status: number; headers?: Record<string, string>; body: any };
}

/**
 * Base class for model testers.
 * Each provider (OpenAI, Claude, Gemini) extends this class.
 */
export abstract class BaseTester {
  protected config: TestConfig;
  protected results: TestResult[] = [];
  protected quotaExhausted = false;

  /** All available test IDs in execution order (cheap → expensive) */
  static readonly TEST_IDS = [
    'promptInjection',
    'openaiCompat',
    'caching',
    'thinking',
    'identity',
    'fingerprint',
    'streaming',
    'latency',
    'stability',
    'contextLength',
    'concurrency',
  ] as const;

  /** Human-readable names */
  static readonly TEST_NAMES: Record<string, string> = {
    custom:          '自定义输入',
    promptInjection: '提示词注入',
    openaiCompat:    'OpenAI 兼容格式',
    caching:         '缓存支持',
    thinking:        '思考/推理能力',
    identity:        '身份验证',
    fingerprint:     '模型指纹',
    streaming:       '流式传输',
    latency:         '响应延迟',
    stability:       '稳定性（多次请求）',
    concurrency:     '并发量',
    contextLength:   '上下文长度',
  };

  constructor(config: TestConfig) {
    this.config = config;
  }

  // ====== Abstract methods ======
  abstract testCustom(prompt: string): Promise<TestResult>;
  abstract testPromptInjection(): Promise<TestResult>;
  abstract testOpenAICompatible(): Promise<TestResult>;
  abstract testCaching(): Promise<TestResult>;
  abstract testThinking(): Promise<TestResult>;
  abstract testIdentity(): Promise<TestResult>;
  abstract testFingerprint(): Promise<TestResult>;
  abstract testStability(): Promise<TestResult>;
  abstract testConcurrency(): Promise<TestResult>;
  abstract testStreaming(): Promise<TestResult>;
  abstract testLatency(): Promise<TestResult>;
  abstract testContextLength(): Promise<TestResult>;

  /** Map testId → method */
  getTestMethod(testId: string, params?: Record<string, string>): (() => Promise<TestResult>) | undefined {
    const map: Record<string, () => Promise<TestResult>> = {
      custom:          () => this.testCustom(params?.customPrompt || 'hi'),
      promptInjection: () => this.testPromptInjection(),
      openaiCompat:    () => this.testOpenAICompatible(),
      caching:         () => this.testCaching(),
      thinking:        () => this.testThinking(),
      identity:        () => this.testIdentity(),
      fingerprint:     () => this.testFingerprint(),
      streaming:       () => this.testStreaming(),
      latency:         () => this.testLatency(),
      stability:       () => this.testStability(),
      concurrency:     () => this.testConcurrency(),
      contextLength:   () => this.testContextLength(),
    };
    return map[testId];
  }

  /** Run a SINGLE test by ID (for the web UI) */
  async runSingle(testId: string, params?: Record<string, string>): Promise<TestResult> {
    const fn = this.getTestMethod(testId, params);
    if (!fn) {
      return createTestResult(testId, 'error', `未知测试: ${testId}`, Date.now());
    }
    try {
      return await fn();
    } catch (err: any) {
      if (isQuotaError(err)) {
        return createTestResult(testId, 'error', `额度已用尽: ${err.message}`, Date.now());
      }
      return createTestResult(testId, 'error', `错误: ${err.message}`, Date.now());
    }
  }

  /** Run all tests in order (for CLI) */
  async runAll(): Promise<TestSuiteResult> {
    const modelInfo = getModelInfo(this.config.modelId);
    console.log('\n' + '='.repeat(60));
    console.log(`测试中: ${this.config.provider} / ${this.config.modelId}`);
    console.log(`基础 URL: ${this.config.baseUrl}`);
    if (modelInfo) {
      console.log(`官方信息: ${modelInfo.displayName}, 上下文=${modelInfo.contextWindow}, 知识截止=${modelInfo.knowledgeCutoff}`);
    } else {
      console.log(`警告：模型 "${this.config.modelId}" 不在官方数据库中`);
    }
    console.log('='.repeat(60) + '\n');

    for (const testId of BaseTester.TEST_IDS) {
      const name = BaseTester.TEST_NAMES[testId];
      if (this.quotaExhausted) {
        const result = createTestResult(name, 'skip', '已跳过：额度已用尽', Date.now());
        this.results.push(result);
        printTestResult(result);
        continue;
      }
      try {
        const result = await this.runSingle(testId);
        this.results.push(result);
        printTestResult(result);
      } catch (err: any) {
        if (isQuotaError(err)) {
          this.quotaExhausted = true;
          const result = createTestResult(name, 'error', `额度已用尽: ${err.message}`, Date.now());
          this.results.push(result);
          printTestResult(result);
          console.log('\n  额度已用尽 - 跳过剩余测试\n');
        } else {
          const result = createTestResult(name, 'error', `错误: ${err.message}`, Date.now());
          this.results.push(result);
          printTestResult(result);
        }
      }
      await sleep(500);
    }

    const suite = buildSuiteResult(this.config.provider, this.config.modelId, this.config.baseUrl, this.results);
    printSuiteSummary(suite);
    return suite;
  }

  // ====== HTTP helpers with raw capture ======

  /** Extra headers for subclasses to inject (e.g. Claude Code CLI simulation) */
  protected getExtraHeaders(): Record<string, string> {
    return {};
  }

  /** Parse a rejected concurrency-probe error into a compact record.
   *  Errors thrown from openaiRequest/nativeRequest carry err.status and err.raw.response.body. */
  protected extractConcurrencyError(err: any): { status?: number; code?: string; type?: string; message: string } {
    const status = typeof err?.status === 'number' ? err.status : undefined;
    let parsed: any = err?.raw?.response?.body;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
    }
    const errObj = (parsed && typeof parsed === 'object') ? (parsed.error ?? parsed) : undefined;
    const code = errObj?.code != null ? String(errObj.code) : undefined;
    // OpenAI/Anthropic use `type`; Google uses `status` string (e.g. "RESOURCE_EXHAUSTED")
    const type = errObj?.type ?? (typeof errObj?.status === 'string' ? errObj.status : undefined);
    const apiMsg = errObj?.message;
    const fallback = String(err?.message ?? '')
      .replace(/^Quota exhausted:\s*/, '')
      .replace(/^HTTP \d+:\s*/, '');
    const message = String(apiMsg ?? fallback ?? '').slice(0, 200);
    return { status, code, type, message };
  }

  /** Group a list of concurrency errors by "status type/code" and return a short label like "429 rate_limit×3, 500×2". */
  protected summarizeConcurrencyErrors(errors: Array<{ status?: number; code?: string; type?: string }>): string {
    if (!errors.length) return '';
    const groups = new Map<string, number>();
    for (const e of errors) {
      const tag = e.type || e.code || '';
      const key = [e.status ?? '?', tag].filter(v => v !== '' && v !== undefined).join(' ');
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return Array.from(groups.entries())
      .map(([k, n]) => n > 1 ? `${k}×${n}` : k)
      .join(', ');
  }

  /** Make an OpenAI-format chat completion request. Returns { data, raw }.
   *  When useStreaming is enabled, transparently uses streaming and assembles the response. */
  protected async openaiRequest(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, any> = {}
  ): Promise<{ data: any; raw: RawExchange }> {
    // Force streaming: delegate to streaming request and assemble into non-streaming format
    if (this.config.useStreaming) {
      const { chunks, fullText, raw } = await this.openaiStreamingRequest(messages, options);
      // Find usage from any chunk (usually the last one, but scan all for robustness)
      let usage: any = undefined;
      for (let i = chunks.length - 1; i >= 0; i--) {
        if (chunks[i]?.usage) { usage = chunks[i].usage; break; }
      }
      const lastChunk = chunks[chunks.length - 1];
      const data: any = {
        model: lastChunk?.model ?? this.config.modelId,
        choices: [{ index: 0, message: { role: 'assistant', content: fullText }, finish_reason: lastChunk?.choices?.[0]?.finish_reason ?? 'stop' }],
        usage,
      };
      return { data, raw };
    }

    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const reqBody: any = { model: this.config.modelId, messages, ...options };
    const extra = this.getExtraHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...extra,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(120000),
    });

    const respText = await resp.text();
    let respBody: any;
    try { respBody = JSON.parse(respText); } catch { respBody = respText; }

    const raw: RawExchange = {
      request: { url, method: 'POST', headers: { ...headers, Authorization: 'Bearer sk-***' }, body: reqBody },
      response: { status: resp.status, body: respBody },
    };

    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}: ${respText.slice(0, 500)}`);
      (err as any).status = resp.status;
      (err as any).raw = raw;
      throw err;
    }

    return { data: respBody, raw };
  }

  /** Backward-compat wrapper — returns just the data */
  protected async openaiChatCompletion(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, any> = {}
  ): Promise<any> {
    const { data } = await this.openaiRequest(messages, options);
    return data;
  }

  /** Streaming OpenAI request — returns chunks + assembled text + raw exchange info */
  protected async openaiStreamingRequest(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, any> = {}
  ): Promise<{ chunks: any[]; fullText: string; raw: RawExchange }> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const reqBody: any = { model: this.config.modelId, messages, stream: true, stream_options: { include_usage: true }, ...options };
    const extra = this.getExtraHeaders();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...extra,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      const err = new Error(`HTTP ${resp.status}: ${errBody}`);
      (err as any).status = resp.status;
      (err as any).raw = {
        request: { url, method: 'POST', headers: { ...headers, Authorization: 'Bearer sk-***' }, body: reqBody },
        response: { status: resp.status, body: errBody },
      };
      throw err;
    }

    const chunks: any[] = [];
    let fullText = '';
    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          chunks.push(parsed);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) fullText += delta;
        } catch {}
      }
    }

    const raw: RawExchange = {
      request: { url, method: 'POST', headers: { ...headers, Authorization: 'Bearer sk-***' }, body: reqBody },
      response: { status: resp.status, body: `[${chunks.length} SSE chunks] assembled text: ${fullText.slice(0, 200)}` },
    };

    return { chunks, fullText, raw };
  }
}
