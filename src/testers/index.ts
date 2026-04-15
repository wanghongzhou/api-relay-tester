import { TestConfig } from '../types/index.js';
import { BaseTester } from './base-tester.js';

export { BaseTester } from './base-tester.js';
export type { RawExchange } from './base-tester.js';

export async function createTester(config: TestConfig): Promise<BaseTester> {
  switch (config.provider) {
    case 'openai': {
      const { default: T } = await import('./openai-tester.js');
      return new T(config);
    }
    case 'claude': {
      const { default: T } = await import('./claude-tester.js');
      return new T(config);
    }
    case 'gemini': {
      const { default: T } = await import('./gemini-tester.js');
      return new T(config);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
