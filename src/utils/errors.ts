import { QuotaExhaustedError } from '../types/index.js';

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
