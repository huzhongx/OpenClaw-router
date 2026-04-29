import type { ProviderConfig } from '../types';
import { BaseProvider } from './base';
import { OpenAIProvider } from './openai';
import { OpenAICompatibleProvider } from './openai-compatible';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { MistralProvider } from './mistral';

const providerTypes: Record<string, new (config: ProviderConfig) => BaseProvider> = {
  'openai': OpenAIProvider,
  'openai-compatible': OpenAICompatibleProvider,
  'anthropic': AnthropicProvider,
  'gemini': GeminiProvider,
  'mistral': MistralProvider,
};

export function createProvider(config: ProviderConfig): BaseProvider {
  const Adapter = providerTypes[config.type];
  if (!Adapter) {
    // Fallback to OpenAI-compatible for unknown types
    return new OpenAICompatibleProvider(config);
  }
  return new Adapter(config);
}

export { BaseProvider, OpenAIProvider, OpenAICompatibleProvider, AnthropicProvider, GeminiProvider, MistralProvider };
