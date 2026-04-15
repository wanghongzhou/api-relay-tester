import { TestResult, TestStatus, TestSuiteResult, QuotaExhaustedError } from './types.js';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

const STATUS_ICONS: Record<TestStatus, string> = {
  pass: `${colors.green}[PASS]${colors.reset}`,
  fail: `${colors.red}[FAIL]${colors.reset}`,
  warn: `${colors.yellow}[WARN]${colors.reset}`,
  skip: `${colors.gray}[SKIP]${colors.reset}`,
  error: `${colors.red}[ERR!]${colors.reset}`,
};

export function printTestResult(result: TestResult): void {
  const icon = STATUS_ICONS[result.status];
  const duration = `${colors.gray}(${result.durationMs}ms)${colors.reset}`;
  console.log(`  ${icon} ${result.testName} ${duration}`);
  if (result.message) {
    console.log(`         ${colors.gray}${result.message}${colors.reset}`);
  }
}

export function printSuiteSummary(suite: TestSuiteResult): void {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.bold}测试摘要: ${suite.provider} - ${suite.modelId}${colors.reset}`);
  console.log(`基础 URL: ${suite.baseUrl}`);
  console.log(`时间: ${suite.timestamp}`);
  console.log('-'.repeat(60));
  console.log(`  总计:   ${suite.summary.total}`);
  console.log(`  ${colors.green}通过:   ${suite.summary.passed}${colors.reset}`);
  console.log(`  ${colors.red}失败:   ${suite.summary.failed}${colors.reset}`);
  console.log(`  ${colors.yellow}警告:   ${suite.summary.warned}${colors.reset}`);
  console.log(`  ${colors.gray}跳过:   ${suite.summary.skipped}${colors.reset}`);
  console.log(`  ${colors.red}错误:   ${suite.summary.errors}${colors.reset}`);
  console.log('='.repeat(60));
}

export function createTestResult(
  testName: string,
  status: TestStatus,
  message: string,
  startTime: number,
  opts?: {
    testId?: string;
    judgment?: string;
    rawRequest?: any;
    rawResponse?: any;
    details?: Record<string, any>;
  }
): TestResult {
  return {
    testName,
    testId: opts?.testId ?? testName.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    status,
    message,
    judgment: opts?.judgment ?? '',
    rawRequest: opts?.rawRequest,
    rawResponse: opts?.rawResponse,
    details: opts?.details,
    durationMs: Date.now() - startTime,
  };
}

export function buildSuiteResult(
  provider: string,
  modelId: string,
  baseUrl: string,
  results: TestResult[]
): TestSuiteResult {
  return {
    provider,
    modelId,
    baseUrl,
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter(r => r.status === 'pass').length,
      failed: results.filter(r => r.status === 'fail').length,
      warned: results.filter(r => r.status === 'warn').length,
      skipped: results.filter(r => r.status === 'skip').length,
      errors: results.filter(r => r.status === 'error').length,
    },
  };
}

export function isQuotaError(error: any): boolean {
  const msg = String(error?.message || error?.error?.message || '').toLowerCase();
  const status = error?.status || error?.statusCode;
  return (
    status === 429 ||
    status === 402 ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('insufficient') ||
    msg.includes('billing') ||
    msg.includes('exceeded') ||
    msg.includes('credit') ||
    msg.includes('balance')
  );
}

export function makeQuotaError(original: Error): QuotaExhaustedError {
  const err = new Error(`Quota exhausted: ${original.message}`) as QuotaExhaustedError;
  err.isQuotaError = true;
  return err;
}

// Generate a long text of approximately N tokens
// Rough estimate: 1 token ≈ 4 chars in English
export function generatePaddingText(targetTokens: number): string {
  const charsPerToken = 4;
  const targetChars = targetTokens * charsPerToken;
  // Use a repeating pattern that's realistic text
  const paragraph = `The World Wide Web Consortium (W3C) develops international standards for the Web including HTML, CSS, and many other technologies. These standards ensure the long-term growth of the Web. Web accessibility means that websites, tools, and technologies are designed and developed so that people with disabilities can use them. More specifically, people can perceive, understand, navigate, and interact with the Web, and they can contribute to the Web. Web accessibility encompasses all disabilities that affect access to the Web, including auditory, cognitive, neurological, physical, speech, and visual disabilities. The Web is fundamentally designed to work for all people, whatever their hardware, software, language, location, or ability. When the Web meets this goal, it is accessible to people with a diverse range of hearing, movement, sight, and cognitive ability. Thus the impact of disability is radically changed on the Web because the Web removes barriers to communication and interaction that many people face in the physical world. However, when websites, applications, technologies, or tools are badly designed, they can create barriers that exclude people from using the Web. `;

  let result = '';
  while (result.length < targetChars) {
    result += paragraph;
  }
  return result.slice(0, targetChars);
}

// Fetch a long document from the web for context length testing
export async function fetchLongDocument(minTokens: number): Promise<{ text: string; source: string }> {
  // Try to fetch W3C specs or other long documents
  const urls = [
    {
      url: 'https://www.w3.org/TR/html52/',
      source: 'W3C HTML 5.2 Specification',
    },
    {
      url: 'https://www.w3.org/TR/CSS22/',
      source: 'W3C CSS 2.2 Specification',
    },
    {
      url: 'https://www.w3.org/TR/WCAG21/',
      source: 'W3C WCAG 2.1',
    },
  ];

  for (const { url, source } of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'ModelTester/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        let text = await resp.text();
        // Strip HTML tags roughly
        text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const estimatedTokens = Math.floor(text.length / 4);
        if (estimatedTokens >= minTokens) {
          return { text: text.slice(0, minTokens * 5), source };
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback: generate synthetic long text
  console.log('  [信息] 无法获取长文档，使用生成的填充文本');
  return {
    text: generatePaddingText(minTokens),
    source: 'Generated padding text (W3C-style)',
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
