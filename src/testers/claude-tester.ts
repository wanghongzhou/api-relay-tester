import { TestResult } from '../types/index.js';
import { BaseTester, RawExchange } from './base-tester.js';
import { getModelInfo } from '../models/index.js';
import {
  createTestResult,
  isQuotaError,
  makeQuotaError,
  generatePaddingText,
  fetchLongDocument,
  sleep,
} from '../utils/index.js';

export class ClaudeTester extends BaseTester {

  // ── helpers ──────────────────────────────────────────────────

  /** Override to inject CLI headers into OpenAI-compat requests too */
  protected override getExtraHeaders(): Record<string, string> {
    return this.claudeCodeCLIHeaders;
  }

  /** Session ID for Claude Code CLI simulation (one per tester instance) */
  private claudeCodeSessionId = crypto.randomUUID();

  /** Simulated device ID (SHA-256 hex, stable per tester instance) */
  private claudeCodeDeviceId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  /** Build metadata field for Claude Code CLI simulation */
  private get claudeCodeMetadata(): Record<string, any> | undefined {
    if (!this.config.simulateClaudeCodeCLI) return undefined;
    return {
      user_id: JSON.stringify({
        device_id: this.claudeCodeDeviceId,
        account_uuid: '',
        session_id: this.claudeCodeSessionId,
      }),
    };
  }

  /** Claude Code CLI headers for simulation mode */
  private get claudeCodeCLIHeaders(): Record<string, string> {
    if (!this.config.simulateClaudeCodeCLI) return {};
    return {
      'Accept': 'application/json',
      'Anthropic-Beta': 'interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,structured-outputs-2025-12-15',
      'Anthropic-Dangerous-Direct-Browser-Access': 'true',
      'X-App': 'cli',
      'X-Claude-Code-Session-Id': this.claudeCodeSessionId,
      'User-Agent': 'claude-cli/2.1.92 (external, cli)',
      'X-Stainless-Os': 'Windows',
      'X-Stainless-Lang': 'js',
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': 'v24.3.0',
      'X-Stainless-Package-Version': '0.80.0',
      'X-Stainless-Arch': 'x64',
      'X-Stainless-Retry-Count': '0',
      'X-Stainless-Timeout': '600',
    };
  }

  /** Wrap request body to match Claude Code CLI format */
  private wrapBodyForCLI(body: Record<string, any>): Record<string, any> {
    if (!this.config.simulateClaudeCodeCLI) return body;

    // Convert simple string content to array format: [{type:"text", text:"..."}]
    if (body.messages) {
      body.messages = body.messages.map((msg: any) => ({
        ...msg,
        content: typeof msg.content === 'string'
          ? [{ type: 'text', text: msg.content }]
          : msg.content,
      }));
    }

    // Add system array with billing header
    if (!body.system) {
      body.system = [
        {
          type: 'text',
          text: 'x-anthropic-billing-header: cc_version=2.1.92.a35; cc_entrypoint=cli; cch=3b6a0;',
        },
        {
          type: 'text',
          text: 'You are Claude Code, Anthropic\'s official CLI for Claude.',
        },
      ];
    }

    // Add empty tools array if not present
    if (!body.tools) {
      body.tools = [];
    }

    // Set CLI-typical defaults
    if (!body.max_tokens) {
      body.max_tokens = 32000;
    }
    if (body.temperature === undefined) {
      body.temperature = 1;
    }

    return body;
  }

  /** Merge Claude Code CLI headers with extra headers (CLI headers are base, extra overrides) */
  private mergeHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const cliHeaders = this.claudeCodeCLIHeaders;
    // If both CLI and extra have anthropic-beta, merge them
    if (cliHeaders['Anthropic-Beta'] && extra['anthropic-beta']) {
      const merged = `${cliHeaders['Anthropic-Beta']},${extra['anthropic-beta']}`;
      const { 'anthropic-beta': _, ...restExtra } = extra;
      return { ...cliHeaders, ...restExtra, 'Anthropic-Beta': merged };
    }
    return { ...cliHeaders, ...extra };
  }

  /** Mask the API key for raw captures */
  private maskedHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const merged = this.mergeHeaders(extra);
    const isCLI = this.config.simulateClaudeCodeCLI;
    return {
      'Content-Type': 'application/json',
      ...(isCLI
        ? { 'Authorization': 'Bearer sk-***' }
        : { 'x-api-key': '***' }),
      'anthropic-version': '2023-06-01',
      ...Object.fromEntries(
        Object.entries(merged).map(([k, v]) => [k, v]),
      ),
    };
  }

  /** POST to the Anthropic native Messages API — returns { data, raw }.
   *  When useStreaming is enabled, transparently uses streaming and assembles the response. */
  private async nativeRequest(
    body: Record<string, any>,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ data: any; raw: RawExchange }> {
    // Force streaming: delegate to streaming request and assemble into non-streaming format
    if (this.config.useStreaming) {
      const { events, fullText, raw } = await this.nativeStreamingRequest(body, extraHeaders);

      // Extract usage from all possible event locations
      const msgStart = events.find((e: any) => e.type === 'message_start');
      const msgDelta = events.find((e: any) => e.type === 'message_delta');

      // Scan all events for any usage data (some proxies put it in different places)
      let inputTokens = msgStart?.message?.usage?.input_tokens;
      let outputTokens = msgDelta?.usage?.output_tokens;
      let cacheRead = msgStart?.message?.usage?.cache_read_input_tokens;
      let cacheCreation = msgStart?.message?.usage?.cache_creation_input_tokens;

      // Fallback: check message_delta for input_tokens too
      if (inputTokens === undefined) {
        inputTokens = msgDelta?.usage?.input_tokens ?? msgDelta?.usage?.prompt_tokens;
      }

      // Fallback: check message_start for prompt_tokens (some proxies use OpenAI naming)
      if (inputTokens === undefined) {
        inputTokens = msgStart?.message?.usage?.prompt_tokens;
      }

      // Fallback: scan all events for any usage object
      if (inputTokens === undefined) {
        for (const evt of events) {
          const u = evt.usage || evt.message?.usage;
          if (u && (u.input_tokens !== undefined || u.prompt_tokens !== undefined)) {
            inputTokens = u.input_tokens ?? u.prompt_tokens;
            if (outputTokens === undefined) outputTokens = u.output_tokens ?? u.completion_tokens;
            if (cacheRead === undefined) cacheRead = u.cache_read_input_tokens;
            if (cacheCreation === undefined) cacheCreation = u.cache_creation_input_tokens;
            break;
          }
        }
      }

      const data: any = {
        content: [{ type: 'text', text: fullText }],
        model: msgStart?.message?.model ?? this.config.modelId,
        role: 'assistant',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheCreation,
        },
      };

      // Preserve thinking blocks if present
      const thinkingDeltas = events.filter((e: any) =>
        e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
      if (thinkingDeltas.length > 0) {
        const thinkingText = thinkingDeltas.map((e: any) => e.delta?.thinking || '').join('');
        data.content = [
          { type: 'thinking', thinking: thinkingText },
          { type: 'text', text: fullText },
        ];
      }
      return { data, raw };
    }

    const url = `${this.config.baseUrl}/v1/messages`;
    const metadata = this.claudeCodeMetadata;
    const reqBody = this.wrapBodyForCLI({ model: this.config.modelId, ...(metadata ? { metadata } : {}), ...body });
    const merged = this.mergeHeaders(extraHeaders);
    const isCLI = this.config.simulateClaudeCodeCLI;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(isCLI
        ? { 'Authorization': `Bearer ${this.config.apiKey}` }
        : { 'x-api-key': this.config.apiKey }),
      'anthropic-version': '2023-06-01',
      ...merged,
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
      request: { url, method: 'POST', headers: this.maskedHeaders(extraHeaders), body: reqBody },
      response: { status: resp.status, body: respBody },
    };

    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}: ${respText.slice(0, 500)}`);
      (err as any).status = resp.status;
      (err as any).raw = raw;
      if (isQuotaError(err)) throw makeQuotaError(err);
      throw err;
    }

    // If proxy returned SSE format even without stream:true, parse the events
    if (typeof respBody === 'string' && respBody.includes('event:') && respBody.includes('data:')) {
      const assembled = this.parseSSEResponse(respBody);
      raw.response.body = respBody;
      return { data: assembled, raw };
    }

    return { data: respBody, raw };
  }

  /** Parse an SSE-formatted response body into a standard Messages API response */
  private parseSSEResponse(sseText: string): any {
    const events: any[] = [];
    let fullText = '';

    for (const line of sseText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(data);
        events.push(parsed);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullText += parsed.delta.text;
        }
      } catch {}
    }

    const msgStart = events.find((e: any) => e.type === 'message_start');
    const msgDelta = events.find((e: any) => e.type === 'message_delta');

    // Assemble usage from all possible locations
    const startUsage = msgStart?.message?.usage;
    const deltaUsage = msgDelta?.usage;

    const inputTokens = startUsage?.input_tokens ?? deltaUsage?.input_tokens ?? startUsage?.prompt_tokens ?? deltaUsage?.prompt_tokens;
    const outputTokens = deltaUsage?.output_tokens ?? startUsage?.output_tokens;

    const result: any = {
      content: [{ type: 'text', text: fullText }],
      model: msgStart?.message?.model,
      role: 'assistant',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: startUsage?.cache_read_input_tokens ?? deltaUsage?.cache_read_input_tokens,
        cache_creation_input_tokens: startUsage?.cache_creation_input_tokens ?? deltaUsage?.cache_creation_input_tokens,
      },
    };

    // Preserve thinking blocks
    const thinkingDeltas = events.filter((e: any) =>
      e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta');
    if (thinkingDeltas.length > 0) {
      const thinkingText = thinkingDeltas.map((e: any) => e.delta?.thinking || '').join('');
      result.content = [
        { type: 'thinking', thinking: thinkingText },
        { type: 'text', text: fullText },
      ];
    }

    return result;
  }

  /** SSE stream reader for the native Messages API — returns { events, fullText, raw } */
  private async nativeStreamingRequest(
    body: Record<string, any>,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ events: any[]; fullText: string; raw: RawExchange }> {
    const url = `${this.config.baseUrl}/v1/messages`;
    const metadata = this.claudeCodeMetadata;
    const reqBody = this.wrapBodyForCLI({ model: this.config.modelId, stream: true, ...(metadata ? { metadata } : {}), ...body });
    const merged = this.mergeHeaders(extraHeaders);
    const isCLI = this.config.simulateClaudeCodeCLI;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(isCLI
        ? { 'Authorization': `Bearer ${this.config.apiKey}` }
        : { 'x-api-key': this.config.apiKey }),
      'anthropic-version': '2023-06-01',
      ...merged,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      const raw: RawExchange = {
        request: { url, method: 'POST', headers: this.maskedHeaders(extraHeaders), body: reqBody },
        response: { status: resp.status, body: errBody },
      };
      const err = new Error(`HTTP ${resp.status}: ${errBody}`);
      (err as any).status = resp.status;
      (err as any).raw = raw;
      if (isQuotaError(err)) throw makeQuotaError(err);
      throw err;
    }

    const events: any[] = [];
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
          events.push(parsed);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
          }
        } catch {
          // skip non-JSON
        }
      }
    }

    const raw: RawExchange = {
      request: { url, method: 'POST', headers: this.maskedHeaders(extraHeaders), body: reqBody },
      response: { status: resp.status, body: `[${events.length} SSE events] assembled text: ${fullText.slice(0, 200)}` },
    };

    return { events, fullText, raw };
  }

  // ── tests ────────────────────────────────────────────────────

  async testCustom(rawJSON: string): Promise<TestResult> {
    const start = Date.now();
    try {
      let body: Record<string, any>;
      try { body = JSON.parse(rawJSON); } catch { body = { max_tokens: 1024, messages: [{ role: 'user', content: rawJSON }] }; }
      const { data, raw } = await this.nativeRequest(body);
      const text = data.content?.map((b: any) => b.text || '').join('') ?? '';
      const inputTokens = data.usage?.input_tokens ?? data.usage?.prompt_tokens;
      const outputTokens = data.usage?.output_tokens ?? data.usage?.completion_tokens;
      return createTestResult('自定义请求', 'pass',
        `响应: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`, start, {
          testId: 'custom',
          judgment: `请求成功。input_tokens=${inputTokens}, output_tokens=${outputTokens}。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { inputTokens, outputTokens, response: text },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('自定义请求', 'error', err.message, start, {
        testId: 'custom',
        judgment: `请求失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testPromptInjection(): Promise<TestResult> {
    const start = Date.now();
    const isCLI = this.config.simulateClaudeCodeCLI;
    try {
      const { data, raw } = await this.nativeRequest({
        max_tokens: 10,
        messages: [{ role: 'user', content: 'hi' }],
      });
      // Try multiple paths for input token count
      const inputTokens = data.usage?.input_tokens ?? data.usage?.prompt_tokens;
      if (inputTokens === undefined) {
        return createTestResult('提示词注入检测', 'warn', '响应中无 token 计数（检查了 usage.input_tokens 和 usage.prompt_tokens）', start, {
          testId: 'promptInjection',
          judgment: '响应未包含 usage.input_tokens 或 usage.prompt_tokens，无法验证 token 计数。代理可能未转发 usage 数据。',
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { usage: data.usage, data },
        });
      }
      // CLI mode injects system prompts, so threshold is higher
      const threshold = isCLI ? 200 : 10;
      if (inputTokens > threshold) {
        return createTestResult('提示词注入检测', 'fail',
          `input_tokens=${inputTokens}（>${threshold}）— 代理可能对提示词进行了包装`, start, {
            testId: 'promptInjection',
            judgment: `发送了消息 "hi"${isCLI ? '（CLI 模式含 system prompt）' : ''}，但收到 input_tokens=${inputTokens}，偏高（预期 <${threshold}）。${isCLI ? '即使考虑 CLI system prompt，token 数仍然偏高。' : '这表明代理正在注入系统提示词或对用户消息进行包装。'}`,
            rawRequest: raw.request,
            rawResponse: raw.response,
            details: { inputTokens },
          });
      }
      return createTestResult('提示词注入检测', 'pass', `input_tokens=${inputTokens}`, start, {
        testId: 'promptInjection',
        judgment: `发送 "hi" 并收到 input_tokens=${inputTokens}${isCLI ? '（CLI 模式含 system prompt，阈值 200）' : ''}，属于合理范围。未发现代理额外包装。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { inputTokens },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('提示词注入检测', 'error', err.message, start, {
        testId: 'promptInjection',
        judgment: `请求失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testOpenAICompatible(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.openaiRequest(
        [{ role: 'user', content: 'Say hello in one word.' }],
        { max_tokens: 20 },
      );
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return createTestResult('OpenAI 兼容格式', 'fail', '响应中无内容', start, {
          testId: 'openaiCompat',
          judgment: '响应中无 choices[0].message.content。代理可能未正确将 Anthropic 响应转换为 OpenAI 格式。',
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { data },
        });
      }
      return createTestResult('OpenAI 兼容格式', 'pass', `响应: "${content.slice(0, 60)}"`, start, {
        testId: 'openaiCompat',
        judgment: `收到有效的 OpenAI 格式响应，内容="${content.slice(0, 80)}"。该 Claude 模型的 /v1/chat/completions 端点工作正常。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('OpenAI 兼容格式', 'error', err.message, start, {
        testId: 'openaiCompat',
        judgment: `OpenAI 兼容请求失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testCaching(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (modelInfo && !modelInfo.supportsCaching) {
      return createTestResult('缓存支持', 'skip', '模型不支持缓存', start, {
        testId: 'caching',
        judgment: `模型 ${this.config.modelId} 在模型数据库中标记为不支持缓存。跳过测试。`,
      });
    }

    // Anthropic requires at least 1024 tokens (Sonnet/Opus) or 2048 (Haiku) for caching
    // ~600 repeats ≈ 1800 tokens, enough for all models
    const systemText = 'You are a helpful assistant who provides detailed and comprehensive answers to all questions. '.repeat(600);
    const body = {
      max_tokens: 10,
      system: [
        {
          type: 'text',
          text: systemText,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    };
    const headers = { 'anthropic-beta': 'prompt-caching-2024-07-31' };

    try {
      // First request — populates cache
      const { raw: raw1 } = await this.nativeRequest(body, headers);
      await sleep(1000);

      // Second request — should hit cache
      const { data: data2, raw: raw2 } = await this.nativeRequest(body, headers);
      const cacheRead = data2.usage?.cache_read_input_tokens ?? 0;

      if (cacheRead > 0) {
        return createTestResult('缓存支持', 'pass',
          `cache_read_input_tokens=${cacheRead}`, start, {
            testId: 'caching',
            judgment: `发送了两次相同请求并设置 cache_control。第二次响应返回 cache_read_input_tokens=${cacheRead}，确认提示词缓存正常工作。`,
            rawRequest: raw2.request,
            rawResponse: raw2.response,
            details: { usage: data2.usage },
          });
      }
      return createTestResult('缓存支持', 'warn',
        `cache_read_input_tokens=${cacheRead} — 缓存可能未启用`, start, {
          testId: 'caching',
          judgment: `发送了两次相同请求并设置 cache_control，但第二次请求的 cache_read_input_tokens=${cacheRead}。缓存可能未启用或该代理不支持缓存。`,
          rawRequest: raw2.request,
          rawResponse: raw2.response,
          details: { usage: data2.usage },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('缓存支持', 'error', err.message, start, {
        testId: 'caching',
        judgment: `缓存测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testThinking(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (modelInfo && !modelInfo.supportsThinking) {
      return createTestResult('思考/推理', 'skip', '模型不支持思考', start, {
        testId: 'thinking',
        judgment: `模型 ${this.config.modelId} 在模型数据库中标记为不支持扩展思考。跳过测试。`,
      });
    }

    try {
      const { data, raw } = await this.nativeRequest(
        {
          max_tokens: 8000,
          thinking: { type: 'enabled', budget_tokens: 5000 },
          messages: [{ role: 'user', content: 'What is 15 * 27? Think step by step.' }],
        },
        { 'anthropic-beta': 'interleaved-thinking-2025-05-14' },
      );

      const thinkingBlock = data.content?.find((b: any) => b.type === 'thinking');
      if (thinkingBlock) {
        const thinkingLen = thinkingBlock.thinking?.length ?? 0;
        return createTestResult('思考/推理', 'pass',
          `发现思考块（${thinkingLen} 字符）`, start, {
            testId: 'thinking',
            judgment: `扩展思考请求返回了一个包含 ${thinkingLen} 字符的思考块。模型正确使用了思考能力来推理数学问题。`,
            rawRequest: raw.request,
            rawResponse: raw.response,
          });
      }
      return createTestResult('思考/推理', 'warn',
        '响应中无思考块 — 扩展思考可能不可用', start, {
          testId: 'thinking',
          judgment: '请求了 budget_tokens=5000 的扩展思考，但响应中未出现思考块。代理可能不支持思考功能或未转发 beta 头。',
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { content: data.content },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('思考/推理', 'error', err.message, start, {
        testId: 'thinking',
        judgment: `思考测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testIdentity(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.nativeRequest({
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: '请用JSON格式输出你的身份信息,包括: model name, provider, version, knowledge_cutoff, context_window',
        }],
      });

      const text = data.content?.map((b: any) => b.text || '').join('') ?? '';
      // Extract JSON from the response (may be wrapped in markdown fences)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return createTestResult('身份验证', 'warn', `无法从响应中提取 JSON: "${text.slice(0, 120)}"`, start, {
          testId: 'identity',
          judgment: `要求模型以 JSON 格式自报身份，但无法从响应中提取 JSON 对象。原始文本: "${text.slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
        });
      }

      let identity: any;
      try {
        identity = JSON.parse(jsonMatch[0]);
      } catch {
        return createTestResult('身份验证', 'warn', `响应中的 JSON 无效: "${jsonMatch[0].slice(0, 120)}"`, start, {
          testId: 'identity',
          judgment: `模型返回了类似 JSON 的内容但解析失败: "${jsonMatch[0].slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
        });
      }

      const modelInfo = getModelInfo(this.config.modelId);
      const issues: string[] = [];

      if (modelInfo) {
        const reportedProvider = String(identity.provider || '').toLowerCase();
        if (reportedProvider && !reportedProvider.includes('anthropic') && !reportedProvider.includes('claude')) {
          issues.push(`provider 不匹配: 自报 "${identity.provider}"，预期 Anthropic`);
        }

        // Check model name — detect model substitution (e.g. Haiku pretending to be Opus)
        const reportedModel = String(identity.model_name || identity.model || '').toLowerCase();
        const expectedModel = modelInfo.displayName.toLowerCase();
        if (reportedModel) {
          // Extract the family name (opus, sonnet, haiku) from both
          const expectedFamily = expectedModel.match(/opus|sonnet|haiku/)?.[0];
          const reportedFamily = reportedModel.match(/opus|sonnet|haiku/)?.[0];
          if (expectedFamily && reportedFamily && expectedFamily !== reportedFamily) {
            issues.push(`model 不匹配: 自报 "${identity.model_name || identity.model}"，预期 ${modelInfo.displayName}（模型系列不同）`);
          }
          // Check version if present
          const expectedVersion = expectedModel.match(/\d+\.\d+/)?.[0];
          const reportedVersion = reportedModel.match(/\d+\.\d+/)?.[0];
          if (expectedVersion && reportedVersion && expectedVersion !== reportedVersion) {
            issues.push(`version 不匹配: 自报版本 "${reportedVersion}"，预期 "${expectedVersion}"`);
          }
        }

        const reportedCtx = Number(identity.context_window);
        if (reportedCtx && modelInfo.contextWindow && Math.abs(reportedCtx - modelInfo.contextWindow) / modelInfo.contextWindow > 0.5) {
          issues.push(`context_window 不匹配: 自报 ${reportedCtx}，预期约 ${modelInfo.contextWindow}`);
        }

        if (identity.knowledge_cutoff && modelInfo.knowledgeCutoff) {
          const reported = String(identity.knowledge_cutoff);
          if (!reported.includes(modelInfo.knowledgeCutoff.slice(0, 4))) {
            issues.push(`knowledge_cutoff 不匹配: 自报 "${reported}"，预期 "${modelInfo.knowledgeCutoff}"`);
          }
        }
      }

      if (issues.length > 0) {
        return createTestResult('身份验证', 'fail', issues.join('; '), start, {
          testId: 'identity',
          judgment: `模型自报身份与官方记录不匹配。问题: ${issues.join('; ')}。这可能表明该代理背后提供的是不同的模型。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { identity, issues },
        });
      }
      return createTestResult('身份验证', 'pass', `身份已验证: ${JSON.stringify(identity).slice(0, 120)}`, start, {
        testId: 'identity',
        judgment: `模型自报身份与官方记录一致。自报: ${JSON.stringify(identity).slice(0, 200)}。未发现不匹配。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { identity },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('身份验证', 'error', err.message, start, {
        testId: 'identity',
        judgment: `身份测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testStability(): Promise<TestResult> {
    const start = Date.now();
    const total = 5;
    let successes = 0;
    const errors: string[] = [];
    let lastRaw: RawExchange | undefined;

    for (let i = 0; i < total; i++) {
      try {
        const { data, raw } = await this.nativeRequest({
          max_tokens: 10,
          messages: [{ role: 'user', content: `Say the number ${i + 1}.` }],
        });
        lastRaw = raw;
        if (data.content && data.content.length > 0) {
          successes++;
        } else {
          errors.push(`请求 ${i + 1}: 内容为空`);
        }
      } catch (err: any) {
        if (isQuotaError(err)) throw makeQuotaError(err);
        if ((err as any).raw) lastRaw = (err as any).raw;
        errors.push(`请求 ${i + 1}: ${err.message}`);
      }
      if (i < total - 1) await sleep(500);
    }

    const rate = successes / total;
    const baseOpts = {
      testId: 'stability' as const,
      rawRequest: lastRaw?.request,
      rawResponse: lastRaw?.response,
      details: { successes, total, errors },
    };

    if (rate === 1) {
      return createTestResult('稳定性', 'pass', `${successes}/${total} 次请求成功`, start, {
        ...baseOpts,
        judgment: `全部 ${total} 次连续请求均成功。端点在轻量连续负载下表现稳定。`,
      });
    }
    if (rate >= 0.6) {
      return createTestResult('稳定性', 'warn', `${successes}/${total} 次成功: ${errors.join('; ')}`, start, {
        ...baseOpts,
        judgment: `${successes}/${total} 次请求成功（${Math.round(rate * 100)}%）。部分失败: ${errors.join('; ')}。端点存在部分不稳定。`,
      });
    }
    return createTestResult('稳定性', 'fail', `${successes}/${total} 次成功: ${errors.join('; ')}`, start, {
      ...baseOpts,
      judgment: `仅 ${successes}/${total} 次请求成功（${Math.round(rate * 100)}%）。失败: ${errors.join('; ')}。端点不可靠。`,
    });
  }

  async testConcurrency(): Promise<TestResult> {
    const start = Date.now();
    const levels = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    let maxConcurrency = 0;
    let lastFailLevel = 0;
    let rateLimitInfo = '';
    const roundDetails: { level: number; successes: number; failures: number; avgMs: number }[] = [];

    try {
      for (const level of levels) {
        const results: { ok: boolean; ms: number; rateLimit?: any }[] = [];

        const tasks = Array.from({ length: level }, () => {
          const t0 = Date.now();
          return this.nativeRequest({
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }).then(() => {
            results.push({ ok: true, ms: Date.now() - t0 });
          }).catch((err: any) => {
            // 429/rate limit is expected — don't rethrow, record as failure
            const msg = String(err.message || '');
            const rateMatch = msg.match(/(\d+)\s*requests?\s*per\s*(\w+)/i);
            const rawBody = (err as any).raw?.response?.body;
            let rateLimit: any = undefined;
            if (typeof rawBody === 'object' && rawBody?.rate_limit) {
              rateLimit = rawBody.rate_limit;
            } else if (typeof rawBody === 'string') {
              try { const p = JSON.parse(rawBody); if (p.rate_limit) rateLimit = p.rate_limit; } catch {}
            }
            if (rateMatch) rateLimitInfo = `${rateMatch[1]} requests/${rateMatch[2]}`;
            if (rateLimit?.limit) rateLimitInfo = `${rateLimit.limit} RPM`;
            results.push({ ok: false, ms: Date.now() - t0, rateLimit });
          });
        });

        await Promise.all(tasks);

        const successes = results.filter(r => r.ok).length;
        const failures = results.filter(r => !r.ok).length;
        const times = results.filter(r => r.ok).map(r => r.ms);
        const avgMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;

        roundDetails.push({ level, successes, failures, avgMs });

        if (successes === level) {
          maxConcurrency = level;
        } else {
          lastFailLevel = level;
          // The actual concurrency limit is the number that succeeded
          if (successes > maxConcurrency) maxConcurrency = successes;
          break;
        }

        await sleep(500);
      }

      const summary = roundDetails.map(r => `${r.level}并发:${r.successes}成功/${r.failures}失败(${r.avgMs}ms)`).join(' → ');
      const hitCeiling = lastFailLevel > 0;
      const limitNote = rateLimitInfo ? `（接口限制: ${rateLimitInfo}）` : '';
      const label = hitCeiling
        ? `并发上限: ${maxConcurrency}${limitNote}`
        : `并发上限: ≥${maxConcurrency}`;

      if (maxConcurrency >= 20) {
        return createTestResult('并发量检测', 'pass', label, start, {
          testId: 'concurrency',
          judgment: `逐级递增测试。${label}。${summary}`,
          details: { maxConcurrency, hitCeiling, rateLimitInfo, rounds: roundDetails },
        });
      }
      if (maxConcurrency >= 5) {
        return createTestResult('并发量检测', 'warn', label, start, {
          testId: 'concurrency',
          judgment: `${label}，中等水平。${summary}`,
          details: { maxConcurrency, hitCeiling, rateLimitInfo, rounds: roundDetails },
        });
      }
      return createTestResult('并发量检测', 'fail', label, start, {
        testId: 'concurrency',
        judgment: `${label}，并发能力差。${summary}`,
        details: { maxConcurrency, hitCeiling, rateLimitInfo, rounds: roundDetails },
      });
    } catch (err: any) {
      return createTestResult('并发量检测', 'error', err.message, start, {
        testId: 'concurrency',
        judgment: `并发量检测失败: ${err.message}`,
        details: { maxConcurrency, rounds: roundDetails },
      });
    }
  }

  async testStreaming(): Promise<TestResult> {
    const start = Date.now();
    const details: Record<string, any> = {};

    try {
      // Native Anthropic streaming
      const nativeResult = await this.nativeStreamingRequest({
        max_tokens: 50,
        messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
      });
      details.nativeEvents = nativeResult.events.length;
      details.nativeText = nativeResult.fullText.slice(0, 80);

      if (nativeResult.events.length === 0) {
        return createTestResult('流式传输', 'fail', '原生流式: 未收到事件', start, {
          testId: 'streaming',
          judgment: '原生 Anthropic 流式请求返回零个 SSE 事件。代理可能不支持流式传输。',
          rawRequest: nativeResult.raw.request,
          rawResponse: nativeResult.raw.response,
          details,
        });
      }

      return createTestResult('流式传输', 'pass',
        `原生流式: ${nativeResult.events.length} 个事件`, start, {
          testId: 'streaming',
          judgment: `原生 Anthropic 流式正常，收到 ${nativeResult.events.length} 个 SSE 事件。文本已正确组装: "${nativeResult.fullText.slice(0, 80)}"`,
          rawRequest: nativeResult.raw.request,
          rawResponse: nativeResult.raw.response,
          details,
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('流式传输', 'error', err.message, start, {
        testId: 'streaming',
        judgment: `流式测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
        details,
      });
    }
  }

  async testLatency(): Promise<TestResult> {
    const start = Date.now();
    try {
      const t0 = Date.now();
      const { data, raw } = await this.nativeRequest({
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      });
      const ttfb = Date.now() - t0;

      if (ttfb < 5000) {
        return createTestResult('响应延迟', 'pass', `TTFB: ${ttfb}ms`, start, {
          testId: 'latency',
          judgment: `首字节时间为 ${ttfb}ms，在可接受范围内（<5000ms）。端点响应迅速。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { ttfb },
        });
      }
      if (ttfb < 15000) {
        return createTestResult('响应延迟', 'warn', `TTFB: ${ttfb}ms（较慢）`, start, {
          testId: 'latency',
          judgment: `首字节时间为 ${ttfb}ms，较慢（5000-15000ms 范围）。可能存在代理或网络带来的额外延迟。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { ttfb },
        });
      }
      return createTestResult('响应延迟', 'fail', `TTFB: ${ttfb}ms（非常慢）`, start, {
        testId: 'latency',
        judgment: `首字节时间为 ${ttfb}ms，非常慢（>15000ms）。表明代理或后端存在严重延迟问题。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { ttfb },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('响应延迟', 'error', err.message, start, {
        testId: 'latency',
        judgment: `延迟测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  async testContextLength(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (!modelInfo) {
      return createTestResult('上下文长度', 'skip', '无模型信息，无法进行上下文长度测试', start, {
        testId: 'contextLength',
        judgment: `模型 "${this.config.modelId}" 不在官方模型数据库中，无法确定预期上下文窗口大小。跳过测试。`,
      });
    }

    // If context window hasn't grown from previous gen, skip the "exceed previous limit" test
    if (modelInfo.previousContextWindow >= modelInfo.contextWindow) {
      return createTestResult('上下文长度', 'skip',
        `上下文窗口未增长（当前=${modelInfo.contextWindow}，上一代=${modelInfo.previousContextWindow}）`, start, {
          testId: 'contextLength',
          judgment: `模型 ${this.config.modelId} 的上下文窗口（${modelInfo.contextWindow}）与上一代相同，无法通过超越上一代限制来验证。跳过测试。`,
        });
    }

    // We want to exceed the previous context window to verify the new one
    const targetTokens = modelInfo.previousContextWindow + 10000;

    try {
      // Try fetching a long document first, fall back to padding
      const { text, source } = await fetchLongDocument(targetTokens);

      const { data, raw } = await this.nativeRequest({
        max_tokens: 100,
        messages: [{ role: 'user', content: `${text}\n\nSummarize the above text in one sentence.` }],
      });

      const inputTokens = data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0;
      const hasContent = Array.isArray(data.content) && data.content.length > 0;

      if (!hasContent) {
        return createTestResult('上下文长度', 'fail',
          '长上下文请求无响应内容', start, {
            testId: 'contextLength',
            judgment: `发送了约 ${targetTokens} 个 token，但响应中无内容。代理可能拒绝了或无法处理长上下文。`,
            rawRequest: raw.request,
            rawResponse: raw.response,
            details: { inputTokens, source },
          });
      }

      // Check that input_tokens is in a reasonable range of what we sent
      if (inputTokens > modelInfo.previousContextWindow) {
        return createTestResult('上下文长度', 'pass',
          `input_tokens=${inputTokens} 超过了上一代限制 ${modelInfo.previousContextWindow}（来源: ${source}）`,
          start, {
            testId: 'contextLength',
            judgment: `成功处理了 ${inputTokens} 个输入 token，超过了上一代的上下文限制 ${modelInfo.previousContextWindow}。确认模型支持声明的 ${modelInfo.contextWindow} token 上下文窗口。`,
            rawRequest: raw.request,
            rawResponse: raw.response,
            details: { inputTokens, targetTokens, previousLimit: modelInfo.previousContextWindow },
          });
      }

      // Still got a response but tokens seem low — proxy might be truncating
      return createTestResult('上下文长度', 'warn',
        `input_tokens=${inputTokens}，预期 >${modelInfo.previousContextWindow} — 代理可能在截断`, start, {
          testId: 'contextLength',
          judgment: `发送了约 ${targetTokens} 个 token，但仅统计了 ${inputTokens} 个。预期 >${modelInfo.previousContextWindow}。代理可能在静默截断输入。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { inputTokens, targetTokens },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw = (err as any).raw;
      return createTestResult('上下文长度', 'error', err.message, start, {
        testId: 'contextLength',
        judgment: `上下文长度测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }
}

export default ClaudeTester;
