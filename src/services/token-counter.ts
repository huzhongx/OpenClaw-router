// Token counting utilities
// Primary: use provider-reported usage from the API response
// Fallback: estimate with js-tiktoken or character-based heuristic

import type { TokenUsage } from '../types';

export function isUsageValid(usage: TokenUsage): boolean {
  return (
    usage &&
    typeof usage.prompt_tokens === 'number' &&
    typeof usage.completion_tokens === 'number' &&
    (usage.prompt_tokens > 0 || usage.completion_tokens > 0)
  );
}

export function emptyUsage(): TokenUsage {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

export function normalizeUsage(usage: any): TokenUsage {
  return {
    prompt_tokens: usage?.prompt_tokens || 0,
    completion_tokens: usage?.completion_tokens || 0,
    total_tokens: usage?.total_tokens || (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0),
  };
}

// Character-based fallback estimation
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Rough heuristic: ~4 chars per token for English, ~1.5 chars per token for CJK
  let cjkCount = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 0x2000) cjkCount++;
  }
  const nonCjkCount = text.length - cjkCount;
  return Math.ceil(nonCjkCount / 4 + cjkCount / 1.5);
}
