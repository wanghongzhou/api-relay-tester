import { TestResult } from '../types/index.js';
import { BaseTester, RawExchange } from './base-tester.js';
import { getModelInfo } from '../models/index.js';
import {
  createTestResult,
  isQuotaError,
  makeQuotaError,
  generatePaddingText,
  sleep,
} from '../utils/index.js';

/** Mask API keys in URLs and headers for raw captures */
function maskKey(url: string, apiKey: string): string {
  if (!apiKey) return url;
  return url.replace(apiKey, '***');
}

export class GeminiTester extends BaseTester {

  // ====== Helper: build RawExchange for native Gemini fetch calls ======
  private buildNativeRaw(
    url: string,
    reqBody: any,
    resp: { status: number },
    respBody: any,
  ): RawExchange {
    return {
      request: {
        url: maskKey(url, this.config.apiKey),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: reqBody,
      },
      response: {
        status: resp.status,
        body: respBody,
      },
    };
  }

  /** Native Gemini generateContent request — returns { data, raw }.
   *  When useStreaming is enabled, transparently uses streaming and assembles the response. */
  private async nativeRequest(
    body: Record<string, any>,
  ): Promise<{ data: any; raw: RawExchange }> {
    // Force streaming: delegate to streaming request and assemble
    if (this.config.useStreaming) {
      const { events, fullText, raw } = await this.nativeStreamingRequest(body);
      // Find usageMetadata from any event (usually the last one)
      let usageMetadata: any = undefined;
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i]?.usageMetadata) { usageMetadata = events[i].usageMetadata; break; }
      }
      const data: any = {
        candidates: [{ content: { parts: [{ text: fullText }] } }],
        usageMetadata,
      };
      return { data, raw };
    }

    const url = `${this.config.baseUrl}/v1beta/models/${this.config.modelId}:generateContent?key=${this.config.apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const respText = await resp.text();
    let respBody: any;
    try { respBody = JSON.parse(respText); } catch { respBody = respText; }

    const raw = this.buildNativeRaw(url, body, resp, respBody);

    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status}: ${respText.slice(0, 500)}`);
      (err as any).status = resp.status;
      (err as any).raw = raw;
      if (isQuotaError(err)) throw makeQuotaError(err);
      throw err;
    }

    return { data: respBody, raw };
  }

  /** Native Gemini streaming request — returns { events, fullText, raw } */
  private async nativeStreamingRequest(
    body: Record<string, any>,
  ): Promise<{ events: any[]; fullText: string; raw: RawExchange }> {
    const url = `${this.config.baseUrl}/v1beta/models/${this.config.modelId}:streamGenerateContent?alt=sse&key=${this.config.apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      const raw = this.buildNativeRaw(url, body, resp, errBody);
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
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) fullText += text;
        } catch {}
      }
    }

    const raw = this.buildNativeRaw(url, body, { status: resp.status },
      `[${events.length} SSE events] assembled text: ${fullText.slice(0, 200)}`);

    return { events, fullText, raw };
  }

  /** Helper to extract text from native Gemini response */
  private extractText(data: any): string {
    return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? '';
  }

  /** Helper to get prompt token count from native Gemini response */
  private getPromptTokens(data: any): number | undefined {
    return data.usageMetadata?.promptTokenCount;
  }

  // ====== Custom test ======
  async testCustom(rawJSON: string): Promise<TestResult> {
    const start = Date.now();
    try {
      let body: Record<string, any>;
      try { body = JSON.parse(rawJSON); } catch { body = { contents: [{ parts: [{ text: rawJSON }] }], generationConfig: { maxOutputTokens: 1024 } }; }
      const { data, raw } = await this.nativeRequest(body);
      const text = this.extractText(data);
      const promptTokens = this.getPromptTokens(data);
      const totalTokens = data.usageMetadata?.totalTokenCount;
      return createTestResult('自定义请求', 'pass',
        `响应: "${text.slice(0, 100)}${text.length > 100 ? '...' : ''}"`, start, {
          testId: 'custom',
          judgment: `请求成功。promptTokenCount=${promptTokens}, totalTokenCount=${totalTokens}。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { promptTokens, totalTokens, response: text },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('自定义请求', 'error', err.message, start, {
        testId: 'custom',
        judgment: `请求失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 1: Prompt Injection Detection ======
  async testPromptInjection(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.nativeRequest({
        contents: [{ parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 5 },
      });

      const promptTokens = this.getPromptTokens(data);
      if (promptTokens == null) {
        return createTestResult('提示词注入检测', 'warn', '响应中无 usageMetadata.promptTokenCount', start, {
          testId: 'promptInjection',
          judgment: '响应未包含 usageMetadata.promptTokenCount 字段——无法判断是否存在代理包装。',
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { response: data },
        });
      }

      if (promptTokens <= 10) {
        return createTestResult('提示词注入检测', 'pass', `promptTokenCount=${promptTokens}（<=10，未检测到套壳）`, start, {
          testId: 'promptInjection',
          judgment: `发送了最简消息 "hi"。API 报告 ${promptTokens} 个 prompt token，<=10，与直连模型一致，未发现代理注入额外系统提示词。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { promptTokens },
        });
      } else {
        return createTestResult('提示词注入检测', 'fail', `promptTokenCount=${promptTokens}（>10，可能存在套壳）`, start, {
          testId: 'promptInjection',
          judgment: `发送了最简消息 "hi"，但 API 报告 ${promptTokens} 个 prompt token（>10）。这表明代理在转发前注入了额外的系统提示词内容。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { promptTokens },
        });
      }
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('提示词注入检测', 'error', `错误: ${err.message}`, start, {
        testId: 'promptInjection',
        judgment: `请求失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 2: OpenAI-Compatible Format ======
  async testOpenAICompatible(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.openaiRequest(
        [{ role: 'user', content: 'Say hello in one word.' }],
        { max_tokens: 20 }
      );

      const content = data.choices?.[0]?.message?.content;
      const usage = data.usage;

      if (!content) {
        return createTestResult('OpenAI 兼容格式', 'fail', '响应 choices 中无内容', start, {
          testId: 'openaiCompat',
          judgment: '响应中 choices[0].message.content 无内容——OpenAI 兼容端点未返回有效的 chat completion 结构。',
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { response: data },
        });
      }
      if (!usage || usage.total_tokens == null) {
        return createTestResult('OpenAI 兼容格式', 'warn', `收到响应但无 usage 数据。内容: "${content}"`, start, {
          testId: 'openaiCompat',
          judgment: `收到有效内容（"${content.slice(0, 80)}"），但缺少 usage.total_tokens。端点可用但不报告 token 用量，某些集成可能需要此数据。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { response: data },
        });
      }

      return createTestResult('OpenAI 兼容格式', 'pass', `响应: "${content.slice(0, 80)}", tokens: ${usage.total_tokens}`, start, {
        testId: 'openaiCompat',
        judgment: `成功收到 chat completion，内容 "${content.slice(0, 80)}"，usage 数据（total_tokens=${usage.total_tokens}）。OpenAI 兼容端点功能正常。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { content, usage },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('OpenAI 兼容格式', 'error', `错误: ${err.message}`, start, {
        testId: 'openaiCompat',
        judgment: `OpenAI 兼容端点请求失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 4: Caching Support ======
  async testCaching(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (modelInfo && !modelInfo.supportsCaching) {
      return createTestResult('缓存支持', 'skip', '模型不支持缓存', start, {
        testId: 'caching',
        judgment: `模型 ${this.config.modelId} 在官方模型数据库中标记为不支持缓存。跳过。`,
      });
    }

    try {
      const longText = 'You are a helpful assistant. '.repeat(500) + '\n\nWhat is 2+2?';
      const body = {
        contents: [
          { parts: [{ text: longText }], role: 'user' },
        ],
        generationConfig: { maxOutputTokens: 20 },
      };

      // First request
      const t1Start = Date.now();
      const { data: resp1, raw: raw1 } = await this.nativeRequest(body);
      const t1 = Date.now() - t1Start;

      await sleep(1000);

      // Second request (same payload, may benefit from caching)
      const t2Start = Date.now();
      const { data: resp2, raw: raw2 } = await this.nativeRequest(body);
      const t2 = Date.now() - t2Start;

      const cachedTokens = resp2.usageMetadata?.cachedContentTokenCount;

      if (cachedTokens && cachedTokens > 0) {
        return createTestResult('缓存支持', 'pass', `第 2 次请求缓存命中: ${cachedTokens} 个缓存 token。耗时: ${t1}ms -> ${t2}ms`, start, {
          testId: 'caching',
          judgment: `发送了两次相同的大型提示词。第二次响应报告 ${cachedTokens} 个缓存 token，确认提供商实现了提示词缓存。延迟从 ${t1}ms 降至 ${t2}ms。`,
          rawRequest: raw2.request,
          rawResponse: raw2.response,
          details: { t1, t2, cachedTokens, usage1: resp1.usageMetadata, usage2: resp2.usageMetadata },
        });
      }

      if (t2 < t1 * 0.7) {
        return createTestResult('缓存支持', 'warn', `第 2 次请求快了 ${Math.round((1 - t2/t1) * 100)}%（${t1}ms -> ${t2}ms），可能存在缓存但无缓存 token 报告`, start, {
          testId: 'caching',
          judgment: `第二次相同请求快了 ${Math.round((1 - t2/t1) * 100)}%（${t1}ms -> ${t2}ms），表明可能存在缓存，但 usageMetadata 中未返回 cachedContentTokenCount 字段。`,
          rawRequest: raw2.request,
          rawResponse: raw2.response,
          details: { t1, t2 },
        });
      }

      return createTestResult('缓存支持', 'warn', `未检测到缓存指标。耗时: ${t1}ms -> ${t2}ms`, start, {
        testId: 'caching',
        judgment: `发送了两次相同的大型提示词。无缓存 token 报告且第二次请求无明显加速（${t1}ms -> ${t2}ms）。缓存可能未启用。`,
        rawRequest: raw2.request,
        rawResponse: raw2.response,
        details: { t1, t2, usage1: resp1.usageMetadata, usage2: resp2.usageMetadata },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('缓存支持', 'error', `错误: ${err.message}`, start, {
        testId: 'caching',
        judgment: `缓存测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 5: Thinking/Reasoning ======
  async testThinking(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (modelInfo && !modelInfo.supportsThinking) {
      return createTestResult('思考/推理', 'skip', '模型不支持思考', start, {
        testId: 'thinking',
        judgment: `模型 ${this.config.modelId} 在官方模型数据库中标记为不支持思考/推理。跳过。`,
      });
    }

    try {
      const { data, raw } = await this.nativeRequest({
        contents: [{ parts: [{ text: 'What is the square root of 144? Think step by step.' }] }],
        generationConfig: {
          maxOutputTokens: 1000,
          thinkingConfig: { thinkingBudget: 5000 },
        },
      });

      const parts = data.candidates?.[0]?.content?.parts || [];
      const thoughtPart = parts.find((p: any) => p.thought === true);
      const textPart = parts.find((p: any) => p.text && !p.thought);

      if (thoughtPart) {
        const thought = thoughtPart.text;
        return createTestResult('思考/推理', 'pass', `原生思考正常。思考内容: "${String(thought).slice(0, 100)}..."`, start, {
          testId: 'thinking',
          judgment: `使用原生 Gemini API 并设置 thinkingConfig（budget=5000）。响应包含思考部分（${String(thought).length} 字符）。确认模型支持结构化思考。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { thought: String(thought).slice(0, 300), text: textPart?.text?.slice(0, 200) },
        });
      }

      const text = this.extractText(data);
      if (text) {
        return createTestResult('思考/推理', 'warn', '收到响应但未发现独立的思考块', start, {
          testId: 'thinking',
          judgment: `发送了 thinkingConfig（budget=5000）但响应中无独立的思考部分。模型可能不支持结构化思考或代理未转发 thinkingConfig。响应: "${text.slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { parts, text: text.slice(0, 300) },
        });
      }

      return createTestResult('思考/推理', 'fail', '响应中无内容', start, {
        testId: 'thinking',
        judgment: '发送了 thinkingConfig 但响应中无任何内容。',
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { data },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('思考/推理', 'error', `错误: ${err.message}`, start, {
        testId: 'thinking',
        judgment: `思考测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 6: Identity Verification ======
  async testIdentity(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.nativeRequest({
        contents: [{ parts: [{ text: '请用JSON格式输出你的身份信息,包括: model name, provider, version, knowledge_cutoff, context_window' }] }],
        generationConfig: { maxOutputTokens: 500 },
      });

      const content = this.extractText(data);
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return createTestResult('身份验证', 'warn', `模型未返回有效 JSON。响应: "${content.slice(0, 200)}"`, start, {
          testId: 'identity',
          judgment: `要求模型以 JSON 格式自报身份。响应中不包含可解析的 JSON 对象。原始响应: "${content.slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { rawContent: content },
        });
      }

      let identity: Record<string, any>;
      try {
        identity = JSON.parse(jsonMatch[0]);
      } catch {
        return createTestResult('身份验证', 'warn', `无法从响应中解析 JSON。原始: "${content.slice(0, 200)}"`, start, {
          testId: 'identity',
          judgment: `响应中包含类似 JSON 的内容但解析失败。原始: "${content.slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { rawContent: content },
        });
      }

      const modelInfo = getModelInfo(this.config.modelId);
      if (!modelInfo) {
        return createTestResult('身份验证', 'warn', `无官方信息可供比对。自报: ${JSON.stringify(identity)}`, start, {
          testId: 'identity',
          judgment: `模型自报身份: ${JSON.stringify(identity)}。但数据库中无 "${this.config.modelId}" 的官方模型信息可供交叉验证。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { identity },
        });
      }

      // Compare reported identity with official info
      const issues: string[] = [];
      const identityStr = JSON.stringify(identity).toLowerCase();

      // Check provider
      if (!identityStr.includes('google') && !identityStr.includes('gemini') && !identityStr.includes('deepmind')) {
        issues.push('provider 未识别为 Google/Gemini');
      }

      // Check model name
      if (!identityStr.includes('gemini')) {
        issues.push('模型名称不包含 "gemini"');
      }

      if (issues.length === 0) {
        return createTestResult('身份验证', 'pass', `身份与 ${modelInfo.displayName} 一致`, start, {
          testId: 'identity',
          judgment: `模型自报身份与 ${modelInfo.displayName} 预期一致。响应中提到 Google/Gemini 作为提供商且模型名称中包含 "gemini"。自报: ${JSON.stringify(identity)}`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { identity, official: modelInfo },
        });
      } else {
        return createTestResult('身份验证', 'fail', `身份问题: ${issues.join('; ')}`, start, {
          testId: 'identity',
          judgment: `身份验证失败。发现问题: ${issues.join('; ')}。自报: ${JSON.stringify(identity)}。预期: ${modelInfo.displayName} by Google。这可能表明提供的是不同的模型。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { identity, official: modelInfo, issues },
        });
      }
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('身份验证', 'error', `错误: ${err.message}`, start, {
        testId: 'identity',
        judgment: `身份测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Fingerprint Test ======
  async testFingerprint(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (!modelInfo) {
      return createTestResult('模型指纹检测', 'skip', '无模型信息，无法进行指纹检测', start, {
        testId: 'fingerprint', judgment: '模型不在数据库中，无法设计指纹题。',
      });
    }
    try {
      const questions = [
        { q: 'What company created you? Reply with ONLY the company name, nothing else.', expect: modelInfo.provider, field: 'provider' },
        { q: 'What is your knowledge cutoff date? Reply with ONLY the date in YYYY-MM format, nothing else.', expect: modelInfo.knowledgeCutoff, field: 'cutoff' },
        { q: 'What is your maximum context window size in tokens? Reply with ONLY the number, nothing else.', expect: String(modelInfo.contextWindow), field: 'context' },
      ];
      const answers: { field: string; expected: string; actual: string; match: boolean }[] = [];
      let lastRaw: any = {};
      for (const { q, expect, field } of questions) {
        const { data, raw } = await this.openaiRequest([{ role: 'user', content: q }], { max_tokens: 50, temperature: 0 });
        lastRaw = raw;
        const answer = (data.choices?.[0]?.message?.content ?? '').trim().toLowerCase();
        const expected = expect.toLowerCase();
        const match = answer.includes(expected) || expected.includes(answer.replace(/[^a-z0-9.-]/g, ''));
        answers.push({ field, expected: expect, actual: answer.slice(0, 100), match });
      }
      const matches = answers.filter(a => a.match).length;
      const status = matches >= 3 ? 'pass' : matches >= 2 ? 'warn' : 'fail';
      return createTestResult('模型指纹检测', status, `${matches}/3 项指纹匹配`, start, {
        testId: 'fingerprint',
        judgment: `通过 3 道知识问题检测模型真实性。${matches}/3 匹配。${answers.map(a => `${a.field}: 预期="${a.expected}" 实际="${a.actual}" ${a.match ? '✓' : '✗'}`).join('；')}`,
        rawRequest: lastRaw.request, rawResponse: lastRaw.response,
        details: { matches, total: 3, answers },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('模型指纹检测', 'error', err.message, start, {
        testId: 'fingerprint', judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request, rawResponse: err.raw?.response,
      });
    }
  }

  // ====== Test 7: Stability (Multi-Request) ======
  async testStability(): Promise<TestResult> {
    const start = Date.now();
    const totalRequests = 5;
    let successes = 0;
    const latencies: number[] = [];
    let lastRaw: RawExchange | undefined;

    try {
      for (let i = 0; i < totalRequests; i++) {
        const reqStart = Date.now();
        try {
          const { data, raw } = await this.nativeRequest({
            contents: [{ parts: [{ text: `Say the number ${i + 1}.` }] }],
            generationConfig: { maxOutputTokens: 10 },
          });
          lastRaw = raw;
          const content = this.extractText(data);
          if (content) successes++;
          latencies.push(Date.now() - reqStart);
        } catch (err: any) {
          if (isQuotaError(err)) throw makeQuotaError(err);
          if (err.raw) lastRaw = err.raw;
          latencies.push(Date.now() - reqStart);
        }
        if (i < totalRequests - 1) await sleep(300);
      }

      const successRate = successes / totalRequests;
      const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      const details = { successes, totalRequests, successRate, avgLatency, latencies };

      if (successRate === 1) {
        return createTestResult('稳定性', 'pass', `${successes}/${totalRequests} 成功, 平均延迟: ${avgLatency}ms`, start, {
          testId: 'stability',
          judgment: `全部 ${totalRequests} 次连续请求均成功，成功率 100%。平均延迟 ${avgLatency}ms。各次延迟: ${latencies.join(', ')}ms。端点稳定。`,
          rawRequest: lastRaw?.request,
          rawResponse: lastRaw?.response,
          details,
        });
      } else if (successRate >= 0.6) {
        return createTestResult('稳定性', 'warn', `${successes}/${totalRequests} 成功（${Math.round(successRate * 100)}%），平均延迟: ${avgLatency}ms`, start, {
          testId: 'stability',
          judgment: `${successes}/${totalRequests} 次请求成功（${Math.round(successRate * 100)}%）。部分请求失败，表明存在间歇性可靠性问题。平均延迟: ${avgLatency}ms。`,
          rawRequest: lastRaw?.request,
          rawResponse: lastRaw?.response,
          details,
        });
      } else {
        return createTestResult('稳定性', 'fail', `${successes}/${totalRequests} 成功（${Math.round(successRate * 100)}%）`, start, {
          testId: 'stability',
          judgment: `仅 ${successes}/${totalRequests} 次请求成功（${Math.round(successRate * 100)}%）。端点不可靠。已完成请求的平均延迟: ${avgLatency}ms。`,
          rawRequest: lastRaw?.request,
          rawResponse: lastRaw?.response,
          details,
        });
      }
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('稳定性', 'error', `错误: ${err.message}`, start, {
        testId: 'stability',
        judgment: `稳定性测试因错误中止: ${err.message}`,
      });
    }
  }

  // ====== Concurrency test ======
  async testConcurrency(): Promise<TestResult> {
    const start = Date.now();
    const levels = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    let maxConcurrency = 0;
    let lastFailLevel = 0;
    let rateLimitInfo = '';
    const roundDetails: { level: number; successes: number; failures: number; avgMs: number }[] = [];

    try {
      for (const level of levels) {
        const results: { ok: boolean; ms: number }[] = [];
        const tasks = Array.from({ length: level }, () => {
          const t0 = Date.now();
          return this.nativeRequest({
            contents: [{ parts: [{ text: 'hi' }] }],
            generationConfig: { maxOutputTokens: 1 },
          }).then(() => { results.push({ ok: true, ms: Date.now() - t0 }); })
            .catch((err: any) => {
              const msg = String(err.message || '');
              const rateMatch = msg.match(/(\d+)\s*requests?\s*per\s*(\w+)/i);
              if (rateMatch) rateLimitInfo = `${rateMatch[1]} requests/${rateMatch[2]}`;
              results.push({ ok: false, ms: Date.now() - t0 });
            });
        });
        await Promise.all(tasks);
        const successes = results.filter(r => r.ok).length;
        const failures = results.filter(r => !r.ok).length;
        const times = results.filter(r => r.ok).map(r => r.ms);
        const avgMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
        roundDetails.push({ level, successes, failures, avgMs });
        if (successes === level) { maxConcurrency = level; } else { lastFailLevel = level; if (successes > maxConcurrency) maxConcurrency = successes; break; }
        await sleep(500);
      }
      const summary = roundDetails.map(r => `${r.level}并发:${r.successes}成功/${r.failures}失败(${r.avgMs}ms)`).join(' → ');
      const hitCeiling = lastFailLevel > 0;
      const limitNote = rateLimitInfo ? `（接口限制: ${rateLimitInfo}）` : '';
      const label = hitCeiling ? `并发上限: ${maxConcurrency}${limitNote}` : `并发上限: ≥${maxConcurrency}`;
      if (maxConcurrency >= 20) return createTestResult('并发量检测', 'pass', label, start, { testId: 'concurrency', judgment: `${label}。${summary}`, details: { maxConcurrency, hitCeiling, rateLimitInfo, rounds: roundDetails } });
      if (maxConcurrency >= 5) return createTestResult('并发量检测', 'warn', label, start, { testId: 'concurrency', judgment: `${label}，中等。${summary}`, details: { maxConcurrency, hitCeiling, rateLimitInfo, rounds: roundDetails } });
      return createTestResult('并发量检测', 'fail', label, start, { testId: 'concurrency', judgment: `${label}，差。${summary}`, details: { maxConcurrency, hitCeiling, rateLimitInfo, rounds: roundDetails } });
    } catch (err: any) {
      return createTestResult('并发量检测', 'error', err.message, start, { testId: 'concurrency', judgment: `失败: ${err.message}`, details: { maxConcurrency, rounds: roundDetails } });
    }
  }

  // ====== Test 8: Streaming ======
  async testStreaming(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { events, fullText, raw } = await this.nativeStreamingRequest({
        contents: [{ parts: [{ text: 'Count from 1 to 5.' }] }],
        generationConfig: { maxOutputTokens: 100 },
      });

      if (events.length === 0) {
        return createTestResult('流式传输', 'fail', '未收到事件', start, {
          testId: 'streaming',
          judgment: '原生 Gemini 流式请求已完成但收到零个 SSE 事件。端点可能不支持流式传输。',
          rawRequest: raw.request,
          rawResponse: raw.response,
        });
      }

      if (!fullText) {
        return createTestResult('流式传输', 'warn', `收到 ${events.length} 个事件但无组装文本`, start, {
          testId: 'streaming',
          judgment: `收到 ${events.length} 个 SSE 事件但其中无文本内容。流式格式可能不标准。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { eventCount: events.length },
        });
      }

      return createTestResult('流式传输', 'pass', `收到 ${events.length} 个事件, 文本: "${fullText.slice(0, 100)}"`, start, {
        testId: 'streaming',
        judgment: `原生 Gemini 流式传输正常。收到 ${events.length} 个 SSE 事件，组装为: "${fullText.slice(0, 100)}"。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { eventCount: events.length, fullText: fullText.slice(0, 200) },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('流式传输', 'error', `错误: ${err.message}`, start, {
        testId: 'streaming',
        judgment: `流式测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 9: Latency (TTFB) ======
  async testLatency(): Promise<TestResult> {
    const start = Date.now();
    try {
      const t0 = Date.now();
      const { data, raw } = await this.nativeRequest({
        contents: [{ parts: [{ text: 'hi' }] }],
        generationConfig: { maxOutputTokens: 5 },
      });
      const ttfb = Date.now() - t0;

      if (ttfb < 2000) {
        return createTestResult('响应延迟', 'pass', `TTFB: ${ttfb}ms`, start, {
          testId: 'latency',
          judgment: `首字节时间为 ${ttfb}ms（<2000ms 阈值）。端点响应迅速。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { ttfb },
        });
      } else if (ttfb < 5000) {
        return createTestResult('响应延迟', 'warn', `TTFB: ${ttfb}ms（较慢）`, start, {
          testId: 'latency',
          judgment: `首字节时间为 ${ttfb}ms，在 2000ms 至 5000ms 之间。慢于理想值，可能存在网络延迟或代理开销。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { ttfb },
        });
      } else {
        return createTestResult('响应延迟', 'fail', `TTFB: ${ttfb}ms（非常慢）`, start, {
          testId: 'latency',
          judgment: `首字节时间为 ${ttfb}ms（>5000ms），非常慢。可能存在严重的代理开销或网络问题。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { ttfb },
        });
      }
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      const raw: RawExchange | undefined = err.raw;
      return createTestResult('响应延迟', 'error', `错误: ${err.message}`, start, {
        testId: 'latency',
        judgment: `延迟测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }

  // ====== Test 10: Context Length ======
  async testContextLength(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    const previousContext = modelInfo?.previousContextWindow ?? 1000000;

    // Gemini models have very large context windows (1M-2M tokens).
    // Generating 1M+ tokens of text is impractical in memory, so we test with
    // a significant but feasible amount and note the limitation.
    const testTokenTarget = Math.min(previousContext, 100000); // Cap at 100K tokens for practicality
    const paddingText = generatePaddingText(testTokenTarget);

    try {
      const { data, raw } = await this.nativeRequest({
        contents: [
          { parts: [{ text: paddingText }], role: 'user' },
          { parts: [{ text: 'Summarize the above text in one sentence.' }], role: 'user' },
        ],
        generationConfig: { maxOutputTokens: 100 },
      });

      const promptTokens = this.getPromptTokens(data);
      const content = this.extractText(data);

      if (promptTokens == null) {
        return createTestResult('上下文长度', 'warn', `收到响应但无 token 计数。目标约 ${testTokenTarget} token。响应: "${content.slice(0, 100)}"`, start, {
          testId: 'contextLength',
          judgment: `发送了约 ${testTokenTarget} 个 token 的填充文本。收到响应（"${content.slice(0, 100)}"）但 usageMetadata 中无 promptTokenCount。无法确认实际处理的 token 数量。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { testTokenTarget, content: content.slice(0, 200) },
        });
      }

      const details = {
        testTokenTarget,
        actualPromptTokens: promptTokens,
        officialContextWindow: modelInfo?.contextWindow,
        previousContextWindow: previousContext,
        note: testTokenTarget < previousContext
          ? `测试使用 ${testTokenTarget} 个 token（为实际可行性设上限；完整的上一代上下文窗口为 ${previousContext} 个 token）`
          : undefined,
      };

      if (promptTokens >= testTokenTarget * 0.8) {
        return createTestResult('上下文长度', 'pass', `处理了约 ${promptTokens} 个 prompt token（目标: ${testTokenTarget}）。官方窗口: ${modelInfo?.contextWindow ?? '未知'}`, start, {
          testId: 'contextLength',
          judgment: `成功处理 ${promptTokens} 个 prompt token（目标 ${testTokenTarget}，80% 阈值 ${Math.round(testTokenTarget * 0.8)}）。官方上下文窗口为 ${modelInfo?.contextWindow ?? '未知'} token。模型无错误地处理了大上下文。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details,
        });
      } else {
        return createTestResult('上下文长度', 'warn', `仅报告 ${promptTokens} 个 prompt token vs 目标 ${testTokenTarget}`, start, {
          testId: 'contextLength',
          judgment: `发送了约 ${testTokenTarget} 个 token，但仅报告 ${promptTokens} 个 prompt token（低于 80% 阈值 ${Math.round(testTokenTarget * 0.8)}）。提供商可能在截断输入或分词器计数差异较大。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details,
        });
      }
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);

      const raw: RawExchange | undefined = err.raw;

      const msg = err.message || '';
      if (msg.includes('too long') || msg.includes('context') || msg.includes('maximum') || msg.includes('length')) {
        return createTestResult('上下文长度', 'warn', `上下文长度测试被拒绝（目标 ${testTokenTarget} token）: ${msg.slice(0, 200)}`, start, {
          testId: 'contextLength',
          judgment: `${testTokenTarget} token 的上下文被拒绝，消息: "${msg.slice(0, 200)}"。这可能表明提供商强制执行了比官方 ${modelInfo?.contextWindow ?? '未知'} token 窗口更小的上下文限制。`,
          rawRequest: raw?.request,
          rawResponse: raw?.response,
          details: { testTokenTarget, error: msg },
        });
      }

      return createTestResult('上下文长度', 'error', `错误: ${err.message}`, start, {
        testId: 'contextLength',
        judgment: `上下文长度测试失败: ${err.message}`,
        rawRequest: raw?.request,
        rawResponse: raw?.response,
      });
    }
  }
}

export default GeminiTester;
