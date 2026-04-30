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
  abstract chatStream(request: ProviderRequest, signal?: AbortSignal): AsyncIterable<StreamChunk>;
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

  /** Merge external signal with timeout signal — either one aborting cancels the fetch */
  protected mergeSignal(signal?: AbortSignal): AbortSignal {
    if (!signal) return AbortSignal.timeout(this.timeout);
    const ac = new AbortController();
    const onTimeout = () => ac.abort(new DOMException('Timeout', 'TimeoutError'));
    const timer = setTimeout(onTimeout, this.timeout);
    const onExternal = () => { clearTimeout(timer); ac.abort(signal.reason); };
    signal.addEventListener('abort', onExternal, { once: true });
    ac.signal.addEventListener('abort', () => { clearTimeout(timer); signal.removeEventListener('abort', onExternal); }, { once: true });
    return ac.signal;
  }
}
