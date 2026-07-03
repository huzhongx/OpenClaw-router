import type {
  ProviderConfig,
  ProviderError,
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

  /**
   * fetch with the provider's timeout. Surfaces timeouts as retryable
   * ProviderErrors (status 504, code upstream_timeout) so the fallback loop
   * in chat.ts/messages.ts can switch to the next provider — mirroring the
   * connect-timeout handling in chatStream. Non-timeout errors (network, DNS,
   * etc.) are rethrown unchanged.
   *
   * Used by the non-streaming chat() path; without this, a 30s upstream hang
   * throws a bare native TimeoutError that carries no retryable flag and so
   * never triggers fallback.
   */
  protected async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(this.timeout) });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        const pe = new Error(`Upstream timeout (${Math.round(this.timeout / 1000)}s)`) as Error & ProviderError;
        pe.status = 504;
        pe.retryable = true;
        pe.code = 'upstream_timeout';
        throw pe;
      }
      throw err;
    }
  }
}
