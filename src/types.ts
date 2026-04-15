// ====== Shared types for model testing tool ======

export interface TestConfig {
  baseUrl: string;       // Provider base URL (without /v1)
  modelId: string;       // Model ID to test
  apiKey: string;        // API key / token
  provider: 'openai' | 'claude' | 'gemini';
  simulateClaudeCodeCLI?: boolean;  // Simulate Claude Code CLI headers
  useStreaming?: boolean;            // Force all requests to use streaming
}

export type TestStatus = 'pass' | 'fail' | 'warn' | 'skip' | 'error';

export interface TestResult {
  testName: string;
  testId: string;           // machine key, e.g. "tokenCount"
  status: TestStatus;
  message: string;          // short conclusion
  judgment: string;         // detailed reasoning / basis for the verdict
  rawRequest?: any;         // the HTTP request we sent (url, headers, body)
  rawResponse?: any;        // the HTTP response we got back
  details?: Record<string, any>;
  durationMs: number;
}

export interface TestSuiteResult {
  provider: string;
  modelId: string;
  baseUrl: string;
  timestamp: string;
  results: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warned: number;
    skipped: number;
    errors: number;
  };
}

// Official model information for verification
export interface ModelInfo {
  modelId: string;
  provider: string;
  displayName: string;
  contextWindow: number;         // Current context window
  previousContextWindow: number; // Previous gen context window (for long context test)
  knowledgeCutoff: string;
  supportsThinking: boolean;
  supportsCaching: boolean;
  supportsStreaming: boolean;
  version?: string;
}

export interface QuotaExhaustedError extends Error {
  isQuotaError: true;
}
