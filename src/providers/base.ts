import type {
  ProviderConfig,
  ProviderRequest,
  ProviderResponse,
  StreamChunk,
} from '../types';

export abstract class BaseProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  abstract chat(request: ProviderRequest): Promise<ProviderResponse>;
  abstract chatStream(request: ProviderRequest): AsyncIterable<StreamChunk>;
  abstract testConnection(): Promise<boolean>;

  get name(): string {
    return this.config.name;
  }

  protected get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  protected get apiKey(): string {
    return this.config.apiKey;
  }

  protected get timeout(): number {
    return this.config.timeoutMs;
  }
}
