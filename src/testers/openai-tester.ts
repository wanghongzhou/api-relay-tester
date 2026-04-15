import { TestResult } from '../types/index.js';
import { BaseTester } from './base-tester.js';
import { getModelInfo } from '../models/index.js';
import {
  createTestResult,
  isQuotaError,
  makeQuotaError,
  fetchLongDocument,
  generatePaddingText,
} from '../utils/index.js';

export class OpenAITester extends BaseTester {

  async testCustom(rawJSON: string): Promise<TestResult> {
    const start = Date.now();
    try {
      let body: any;
      try { body = JSON.parse(rawJSON); } catch { body = null; }
      const messages = body?.messages || [{ role: 'user', content: rawJSON }];
      const { messages: _, ...options } = body || {};
      const { data, raw } = await this.openaiRequest(messages, options);
      const content = data.choices?.[0]?.message?.content ?? '';
      const promptTokens = data.usage?.prompt_tokens;
      const completionTokens = data.usage?.completion_tokens;
      return createTestResult('自定义请求', 'pass',
        `响应: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`, start, {
          testId: 'custom',
          judgment: `请求成功。prompt_tokens=${promptTokens}, completion_tokens=${completionTokens}。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { promptTokens, completionTokens, response: content },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('自定义请求', 'error', err.message, start, {
        testId: 'custom',
        judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 1: Send "hi", check prompt_tokens <= 10 (detects proxy wrapping) */
  async testPromptInjection(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.openaiRequest([{ role: 'user', content: 'hi' }]);
      const promptTokens = data.usage?.prompt_tokens;
      if (promptTokens === undefined) {
        return createTestResult('提示词注入检测', 'warn', '响应中无 usage.prompt_tokens', start, {
          testId: 'promptInjection',
          judgment: `发送了一条最简消息 'hi' 来检查 token 开销。响应中未包含 usage.prompt_tokens，因此无法判断代理是否对请求进行了包装。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { response: data },
        });
      }
      if (promptTokens <= 10) {
        return createTestResult('提示词注入检测', 'pass', `prompt_tokens=${promptTokens}（未检测到套壳）`, start, {
          testId: 'promptInjection',
          judgment: `发送 'hi'（1 个 token），预期 prompt_tokens <= 10。实际为 ${promptTokens}。在预期范围内，表明代理未注入大量系统提示词。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { promptTokens },
        });
      }
      return createTestResult('提示词注入检测', 'fail', `prompt_tokens=${promptTokens}（>10，可能存在套壳）`, start, {
        testId: 'promptInjection',
        judgment: `发送 'hi'（1 个 token），预期 prompt_tokens <= 10。实际为 ${promptTokens}。明显超出阈值，表明代理注入了大量系统提示词包装。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { promptTokens },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('提示词注入检测', 'error', err.message, start, {
        testId: 'promptInjection',
        judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 2: OpenAI-compatible format */
  async testOpenAICompatible(): Promise<TestResult> {
    const start = Date.now();
    return createTestResult('OpenAI 兼容格式', 'skip', 'OpenAI 模型本身就是 OpenAI 格式，无需兼容性测试', start, {
      testId: 'openaiCompat',
      judgment: 'OpenAI 模型的原生协议就是 OpenAI 格式，跳过兼容性测试。其他测试项已验证 API 可用性。',
    });
  }

  /** Test 4: Caching - send same request twice, compare timing */
  async testCaching(): Promise<TestResult> {
    const start = Date.now();
    try {
      const messages = [{ role: 'user' as const, content: 'Repeat exactly: "cache test response"' }];

      const t1Start = Date.now();
      const { data: resp1, raw: raw1 } = await this.openaiRequest(messages, { temperature: 0 });
      const t1 = Date.now() - t1Start;

      const t2Start = Date.now();
      const { data: resp2, raw: raw2 } = await this.openaiRequest(messages, { temperature: 0 });
      const t2 = Date.now() - t2Start;

      const cachedTokens = resp2.usage?.prompt_tokens_details?.cached_tokens ?? resp2.usage?.cached_tokens;
      const hasCacheHit = cachedTokens !== undefined && cachedTokens > 0;
      const fasterSecond = t2 < t1 * 0.8;

      if (hasCacheHit) {
        return createTestResult('缓存支持', 'pass', `检测到缓存命中: ${cachedTokens} 个缓存 token`, start, {
          testId: 'caching',
          judgment: `发送了两次相同请求（temperature=0）。第二次响应报告了 ${cachedTokens} 个缓存 token，确认提示词缓存已启用。`,
          rawRequest: raw2.request,
          rawResponse: raw2.response,
          details: { firstMs: t1, secondMs: t2, cachedTokens },
        });
      }
      if (fasterSecond) {
        return createTestResult('缓存支持', 'warn', `第二次请求快了 ${Math.round((1 - t2 / t1) * 100)}%（可能存在缓存）`, start, {
          testId: 'caching',
          judgment: `发送了两次相同请求。响应中无 cached_tokens 字段，但第二次请求快了 ${Math.round((1 - t2 / t1) * 100)}%（${t1}ms vs ${t2}ms），表明可能存在服务端缓存。`,
          rawRequest: raw2.request,
          rawResponse: raw2.response,
          details: { firstMs: t1, secondMs: t2 },
        });
      }
      return createTestResult('缓存支持', 'warn', '未检测到缓存指标（OpenAI 可能不缓存短提示词）', start, {
        testId: 'caching',
        judgment: `发送了两次相同请求。无 cached_tokens 字段且无明显速度提升（${t1}ms vs ${t2}ms）。OpenAI 通常需要提示词超过 1024 个 token 才会激活缓存。`,
        rawRequest: raw2.request,
        rawResponse: raw2.response,
        details: { firstMs: t1, secondMs: t2 },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('缓存支持', 'error', err.message, start, {
        testId: 'caching',
        judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 5: Thinking/reasoning support */
  async testThinking(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    const isOSeries = /^o\d/.test(this.config.modelId);
    const supportsReasoning = isOSeries || modelInfo?.supportsThinking;

    if (!supportsReasoning) {
      return createTestResult('思考/推理', 'skip', `模型 ${this.config.modelId} 不支持思考/推理`, start, {
        testId: 'thinking',
        judgment: `模型 ${this.config.modelId} 不是 o 系列模型且 modelInfo.supportsThinking 为 false。跳过思考测试。`,
      });
    }

    try {
      const options: Record<string, any> = {};
      if (isOSeries || modelInfo?.supportsThinking) {
        options.reasoning_effort = 'low';
      }

      const { data, raw } = await this.openaiRequest(
        [{ role: 'user', content: 'What is 15 * 37? Think step by step.' }],
        options
      );

      const message = data.choices?.[0]?.message;
      const hasReasoning = message?.reasoning_content || message?.reasoning;
      const content = message?.content;

      if (hasReasoning) {
        return createTestResult('思考/推理', 'pass', '响应中包含推理内容', start, {
          testId: 'thinking',
          judgment: `提问 'What is 15 * 37? Think step by step.' ${options.reasoning_effort ? '并设置 reasoning_effort=low' : ''}。响应包含推理字段（${String(hasReasoning).length} 字符），确认模型支持结构化思考输出。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: {
            reasoningPreview: String(hasReasoning).slice(0, 200),
            content: content?.slice(0, 100),
          },
        });
      }
      if (content) {
        return createTestResult('思考/推理', 'warn', '收到响应但未找到推理字段', start, {
          testId: 'thinking',
          judgment: `提问了一道数学题并要求逐步思考。收到了内容但响应中无 reasoning_content 或 reasoning 字段。模型可能在内容中内联进行了思维链推理，而非使用独立字段。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: {
            content: content.slice(0, 200),
            usage: data.usage,
          },
        });
      }
      return createTestResult('思考/推理', 'fail', '响应中无内容或推理信息', start, {
        testId: 'thinking',
        judgment: `提问了一道数学题，但响应中既无内容也无推理字段。`,
        rawRequest: raw.request,
        rawResponse: raw.response,
        details: { response: data },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('思考/推理', 'error', err.message, start, {
        testId: 'thinking',
        judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 6: Identity verification */
  async testIdentity(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { data, raw } = await this.openaiRequest([{
        role: 'user',
        content: '请用JSON格式输出你的身份信息,包括: model name, provider, version, knowledge_cutoff, context_window。只输出JSON,不要其他文字。',
      }], { temperature: 0 });

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return createTestResult('身份验证', 'fail', '响应中无内容', start, {
          testId: 'identity',
          judgment: `要求模型以 JSON 格式自报身份信息，但响应中无内容。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
        });
      }

      // Try to extract JSON from the response (may be wrapped in markdown code block)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return createTestResult('身份验证', 'warn', '无法从响应中解析 JSON', start, {
          testId: 'identity',
          judgment: `模型已响应但输出中不包含 JSON 对象。原始内容: "${content.slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { rawContent: content.slice(0, 500) },
        });
      }

      let identity: any;
      try {
        identity = JSON.parse(jsonMatch[0]);
      } catch {
        return createTestResult('身份验证', 'warn', '响应中的 JSON 无效', start, {
          testId: 'identity',
          judgment: `模型返回了类似 JSON 的内容但解析失败。原始内容: "${jsonMatch[0].slice(0, 200)}"`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { rawContent: content.slice(0, 500) },
        });
      }

      const modelInfo = getModelInfo(this.config.modelId);
      if (!modelInfo) {
        return createTestResult('身份验证', 'warn', `获取到身份信息但无官方模型信息可供比对`, start, {
          testId: 'identity',
          judgment: `模型自报身份: ${JSON.stringify(identity).slice(0, 300)}。数据库中无该模型的官方信息可供验证。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { identity },
        });
      }

      // Check model name and provider
      const identityStr = JSON.stringify(identity).toLowerCase();
      const providerMatch = identityStr.includes(modelInfo.provider.toLowerCase()) || identityStr.includes('openai');
      const modelMatch = identityStr.includes(modelInfo.displayName.toLowerCase()) ||
        identityStr.includes(this.config.modelId.toLowerCase());

      if (providerMatch && modelMatch) {
        return createTestResult('身份验证', 'pass', '模型身份与官方信息一致', start, {
          testId: 'identity',
          judgment: `模型自报身份匹配。预期 provider="${modelInfo.provider}" 和 model="${modelInfo.displayName}"。两者均在响应 JSON 中找到。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: {
            identity,
            officialProvider: modelInfo.provider,
            officialModel: modelInfo.displayName,
          },
        });
      }

      return createTestResult('身份验证', 'warn',
        `身份不匹配: 自报=${JSON.stringify(identity).slice(0, 200)}, 预期 provider=${modelInfo.provider}, model=${modelInfo.displayName}`,
        start, {
          testId: 'identity',
          judgment: `模型自报身份不匹配。预期 provider="${modelInfo.provider}"（匹配=${providerMatch}）和 model="${modelInfo.displayName}"（匹配=${modelMatch}）。自报: ${JSON.stringify(identity).slice(0, 300)}`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { identity, modelInfo: { provider: modelInfo.provider, displayName: modelInfo.displayName } },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('身份验证', 'error', err.message, start, {
        testId: 'identity',
        judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Fingerprint test: use knowledge-based questions to verify model identity */
  async testFingerprint(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);
    if (!modelInfo) {
      return createTestResult('模型指纹检测', 'skip', '无模型信息，无法进行指纹检测', start, {
        testId: 'fingerprint',
        judgment: '模型不在数据库中，无法设计指纹题。',
      });
    }

    try {
      const questions = [
        { q: 'What company created you? Reply with ONLY the company name, nothing else.', expect: modelInfo.provider, field: 'provider' },
        { q: `What is your knowledge cutoff date? Reply with ONLY the date in YYYY-MM format, nothing else.`, expect: modelInfo.knowledgeCutoff, field: 'cutoff' },
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
      const label = `${matches}/3 项指纹匹配`;
      return createTestResult('模型指纹检测', status, label, start, {
        testId: 'fingerprint',
        judgment: `通过 3 道知识问题检测模型真实性（provider、知识截止、上下文窗口）。${matches}/3 匹配。${answers.map(a => `${a.field}: 预期="${a.expected}" 实际="${a.actual}" ${a.match ? '✓' : '✗'}`).join('；')}`,
        rawRequest: lastRaw.request,
        rawResponse: lastRaw.response,
        details: { matches, total: 3, answers },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('模型指纹检测', 'error', err.message, start, {
        testId: 'fingerprint',
        judgment: `请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 7: Stability - 5 sequential requests */
  async testStability(): Promise<TestResult> {
    const start = Date.now();
    const times: number[] = [];
    let failures = 0;
    let lastRaw: any = null;

    for (let i = 0; i < 5; i++) {
      const reqStart = Date.now();
      try {
        const { raw } = await this.openaiRequest([{ role: 'user', content: "Say 'ok'" }], { max_tokens: 5 });
        times.push(Date.now() - reqStart);
        lastRaw = raw;
      } catch (err: any) {
        if (isQuotaError(err)) throw makeQuotaError(err);
        failures++;
        times.push(Date.now() - reqStart);
        if (err.raw) lastRaw = err.raw;
      }
    }

    const successRate = ((5 - failures) / 5) * 100;
    const avgTime = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

    if (failures === 0) {
      return createTestResult('稳定性', 'pass', `5/5 成功, 平均 ${avgTime}ms`, start, {
        testId: 'stability',
        judgment: `连续发送 5 次请求要求回复 'ok'。全部 5 次成功，耗时 [${times.join(', ')}]ms（平均 ${avgTime}ms）。端点稳定。`,
        rawRequest: lastRaw?.request,
        rawResponse: lastRaw?.response,
        details: { times, successRate },
      });
    }
    if (failures <= 1) {
      return createTestResult('稳定性', 'warn', `${5 - failures}/5 成功, 平均 ${avgTime}ms`, start, {
        testId: 'stability',
        judgment: `连续发送 5 次请求。${failures} 次失败。耗时: [${times.join(', ')}]ms。检测到轻微不稳定。`,
        rawRequest: lastRaw?.request,
        rawResponse: lastRaw?.response,
        details: { times, successRate, failures },
      });
    }
    return createTestResult('稳定性', 'fail', `${5 - failures}/5 成功（${failures} 次失败）`, start, {
      testId: 'stability',
      judgment: `连续发送 5 次请求。${failures} 次失败（成功率 ${successRate}%）。耗时: [${times.join(', ')}]ms。端点不可靠。`,
      rawRequest: lastRaw?.request,
      rawResponse: lastRaw?.response,
      details: { times, successRate, failures },
    });
  }

  /** Concurrency test — find max concurrency */
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
          return this.openaiRequest([{ role: 'user', content: 'hi' }], { max_tokens: 1 })
            .then(() => { results.push({ ok: true, ms: Date.now() - t0 }); })
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
        await new Promise(r => setTimeout(r, 500));
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

  /** Test 8: Streaming support */
  async testStreaming(): Promise<TestResult> {
    const start = Date.now();
    try {
      const { chunks, fullText, raw } = await this.openaiStreamingRequest(
        [{ role: 'user', content: 'Count from 1 to 5, separated by commas.' }],
        { max_tokens: 50 }
      );

      if (chunks.length === 0) {
        return createTestResult('流式传输', 'fail', '未收到任何数据块', start, {
          testId: 'streaming',
          judgment: `发送了流式请求但收到 0 个 SSE 数据块。该端点可能不支持流式传输。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
        });
      }
      if (!fullText) {
        return createTestResult('流式传输', 'fail', '收到数据块但无法组装内容', start, {
          testId: 'streaming',
          judgment: `收到 ${chunks.length} 个 SSE 数据块但其中无 delta 内容。流式格式可能不标准。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { chunkCount: chunks.length },
        });
      }
      return createTestResult('流式传输', 'pass',
        `${chunks.length} 个数据块, 内容: "${fullText.slice(0, 80)}"`, start, {
          testId: 'streaming',
          judgment: `流式请求成功。收到 ${chunks.length} 个 SSE 数据块，组装为 "${fullText.slice(0, 100)}"。流式传输功能正常。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { chunkCount: chunks.length, fullText: fullText.slice(0, 200) },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('流式传输', 'error', err.message, start, {
        testId: 'streaming',
        judgment: `流式请求失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 9: Response latency (time to first byte) */
  async testLatency(): Promise<TestResult> {
    const start = Date.now();
    try {
      const url = `${this.config.baseUrl}/v1/chat/completions`;
      const reqBody = {
        model: this.config.modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: true,
      };
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      };

      const ttfbStart = Date.now();
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody),
        signal: AbortSignal.timeout(60000),
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

      // Read until first data chunk
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let ttfb: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        if (text.includes('data: ')) {
          ttfb = Date.now() - ttfbStart;
          // Cancel the rest
          reader.cancel().catch(() => {});
          break;
        }
      }

      const rawExchange = {
        request: { url, method: 'POST', headers: { ...headers, Authorization: 'Bearer sk-***' }, body: reqBody },
        response: { status: resp.status, body: `[streaming] TTFB=${ttfb}ms` },
      };

      if (ttfb === null) {
        return createTestResult('响应延迟', 'warn', '无法测量 TTFB', start, {
          testId: 'latency',
          judgment: `发送了 max_tokens=1 的流式请求，但无法在响应流中检测到 'data: ' 行。TTFB 测量失败。`,
          rawRequest: rawExchange.request,
          rawResponse: rawExchange.response,
        });
      }

      const status = ttfb < 3000 ? 'pass' : ttfb < 10000 ? 'warn' : 'fail';
      return createTestResult('响应延迟', status, `首字节时间: ${ttfb}ms`, start, {
        testId: 'latency',
        judgment: `测量首个 SSE 'data:' 行的到达时间: ${ttfb}ms。${ttfb < 3000 ? '低于 3 秒阈值——延迟良好。' : ttfb < 10000 ? '在 3-10 秒之间——延迟偏高。' : '超过 10 秒——延迟过高，不可接受。'}`,
        rawRequest: rawExchange.request,
        rawResponse: rawExchange.response,
        details: { ttfbMs: ttfb },
      });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      return createTestResult('响应延迟', 'error', err.message, start, {
        testId: 'latency',
        judgment: `延迟测试失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }

  /** Test 10: Context length test */
  async testContextLength(): Promise<TestResult> {
    const start = Date.now();
    const modelInfo = getModelInfo(this.config.modelId);

    if (!modelInfo) {
      return createTestResult('上下文长度', 'skip', '无模型信息，无法进行上下文长度测试', start, {
        testId: 'contextLength',
        judgment: `模型 "${this.config.modelId}" 不在数据库中，无法确定目标上下文窗口大小。`,
      });
    }

    const targetTokens = modelInfo.previousContextWindow;
    if (!targetTokens || targetTokens < 1000) {
      return createTestResult('上下文长度', 'skip', '未定义 previousContextWindow', start, {
        testId: 'contextLength',
        judgment: `模型信息存在但 previousContextWindow 为 ${targetTokens ?? 'undefined'}，过小或缺失。跳过。`,
      });
    }

    try {
      // Try fetching a long document first, fall back to generated text
      const { text, source } = await fetchLongDocument(targetTokens);

      const prompt = `Below is a long document. After reading it, answer: What is 2+2? Answer with just the number.\n\n${text}`;

      const { data, raw } = await this.openaiRequest(
        [{ role: 'user', content: prompt }],
        { max_tokens: 10 }
      );

      const promptTokens = data.usage?.prompt_tokens;
      const content = data.choices?.[0]?.message?.content;

      if (!promptTokens) {
        return createTestResult('上下文长度', 'warn', '响应中无 token 计数', start, {
          testId: 'contextLength',
          judgment: `发送了约 ${targetTokens} 个 token 的上下文（来源: ${source}），但响应未包含 usage.prompt_tokens。无法验证上下文处理。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { source, content },
        });
      }

      // Check if prompt_tokens is at least 50% of what we targeted
      const ratio = promptTokens / targetTokens;
      if (ratio >= 0.5) {
        return createTestResult('上下文长度', 'pass',
          `发送约 ${targetTokens} 目标 token，API 报告 ${promptTokens} prompt_tokens（${Math.round(ratio * 100)}%）`,
          start, {
            testId: 'contextLength',
            judgment: `目标为 ${targetTokens} 个 token（${this.config.modelId} 的 previousContextWindow）。API 报告 ${promptTokens} prompt_tokens（目标的 ${Math.round(ratio * 100)}%）。模型成功处理了长上下文。来源: ${source}。`,
            rawRequest: raw.request,
            rawResponse: raw.response,
            details: { targetTokens, promptTokens, ratio, source, content: content?.slice(0, 100) },
          });
      }

      return createTestResult('上下文长度', 'warn',
        `Token 计数低于预期: ${promptTokens} vs 目标 ${targetTokens}（${Math.round(ratio * 100)}%）`,
        start, {
          testId: 'contextLength',
          judgment: `目标为 ${targetTokens} 个 token，但 API 仅报告 ${promptTokens} prompt_tokens（${Math.round(ratio * 100)}%）。输入可能被截断或 token 估算有误。来源: ${source}。`,
          rawRequest: raw.request,
          rawResponse: raw.response,
          details: { targetTokens, promptTokens, ratio, source },
        });
    } catch (err: any) {
      if (isQuotaError(err)) throw makeQuotaError(err);
      // A context length error might actually indicate the model can't handle it
      const msg = String(err.message).toLowerCase();
      if (msg.includes('context') || msg.includes('token') || msg.includes('length') || msg.includes('too long')) {
        return createTestResult('上下文长度', 'fail',
          `模型拒绝了长上下文（目标: ${targetTokens} token）: ${err.message.slice(0, 200)}`,
          start, {
            testId: 'contextLength',
            judgment: `发送了约 ${targetTokens} 个 token，但模型以上下文/token 相关错误拒绝了输入: "${err.message.slice(0, 300)}"。该模型可能不支持此上下文长度。`,
            rawRequest: err.raw?.request,
            rawResponse: err.raw?.response,
            details: { targetTokens, error: err.message },
          });
      }
      return createTestResult('上下文长度', 'error', err.message, start, {
        testId: 'contextLength',
        judgment: `请求因非上下文相关错误失败: ${err.message}`,
        rawRequest: err.raw?.request,
        rawResponse: err.raw?.response,
      });
    }
  }
}

export default OpenAITester;
