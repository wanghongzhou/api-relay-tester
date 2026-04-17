#!/usr/bin/env tsx
/**
 * Model Testing Tool - CLI Entry Point
 *
 * Tests relay/proxy services for authenticity, stability, and compliance.
 *
 * Usage:
 *   npx tsx src/cli/index.ts --base-url <url> --model <id> --api-key <key> [--provider <openai|claude|gemini>]
 *
 * Examples:
 *   npx tsx src/cli/index.ts --base-url https://api.favorais.com --model claude-opus-4-6 --api-key sk-xxx --provider claude
 *   npx tsx src/cli/index.ts --base-url https://api.favorais.com --model gpt-5.4 --api-key sk-xxx
 */

import { TestConfig, TestSuiteResult } from '../types/index.js';
import { printSuiteSummary } from '../utils/index.js';
import { createTester } from '../testers/index.js';

// Auto-detect provider from model ID
function detectProvider(modelId: string): 'openai' | 'claude' | 'gemini' {
  const lower = modelId.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return 'claude';
  if (lower.includes('gemini') || lower.includes('google')) return 'gemini';
  // Default to openai for gpt, o1, o3, etc.
  return 'openai';
}

// Parse command-line arguments
function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  let baseUrl = '';
  let modelId = '';
  let apiKey = '';
  let provider: 'openai' | 'claude' | 'gemini' | '' = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--base-url':
      case '-u':
        baseUrl = args[++i] ?? '';
        break;
      case '--model':
      case '-m':
        modelId = args[++i] ?? '';
        break;
      case '--api-key':
      case '-k':
        apiKey = args[++i] ?? '';
        break;
      case '--provider':
      case '-p':
        provider = (args[++i] ?? '') as any;
        break;
      case '--help':
      case '-h':
        console.log(`
模型测试工具 - 测试中转/代理服务的真实性

用法:
  npx tsx src/cli/index.ts [选项]

选项:
  --base-url, -u   服务商基础 URL（不含 /v1）
  --model, -m      要测试的模型 ID（例如 claude-opus-4-6, gpt-5.4）
  --api-key, -k    API 密钥 / 令牌
  --provider, -p   服务商: openai, claude 或 gemini（未指定时自动检测）
  --help, -h       显示此帮助信息
`);
        process.exit(0);
    }
  }

  // Remove trailing slash from base URL
  baseUrl = baseUrl.replace(/\/+$/, '');

  if (!baseUrl || !modelId || !apiKey) {
    console.error('错误: --base-url、--model 和 --api-key 为必填项');
    console.error('使用 --help 查看用法信息');
    process.exit(1);
  }

  if (!provider) {
    provider = detectProvider(modelId);
    console.log(`自动检测到服务商: ${provider}`);
  }

  return { baseUrl, modelId, apiKey, provider };
}

// Exported for programmatic use
export async function runTest(config: TestConfig): Promise<TestSuiteResult> {
  const tester = await createTester(config);
  return tester.runAll();
}

// CLI entry point
async function main() {
  const config = parseArgs();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           模型中转/代理测试工具 v1.0                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n目标: ${config.baseUrl}`);
  console.log(`模型:  ${config.modelId}`);
  console.log(`服务商: ${config.provider}\n`);

  const result = await runTest(config);

  // Write results to JSON file
  const fs = await import('fs');
  const outputFile = `test-result-${config.provider}-${config.modelId.replace(/[^a-zA-Z0-9.-]/g, '_')}-${Date.now()}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`\n结果已保存至: ${outputFile}`);

  // Exit with error code if any tests failed
  if (result.summary.failed > 0 || result.summary.errors > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('致命错误:', err);
  process.exit(1);
});
