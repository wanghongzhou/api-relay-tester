import { TestResult, TestStatus, TestSuiteResult } from '../types/index.js';

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
