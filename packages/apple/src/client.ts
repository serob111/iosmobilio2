import { AppStoreConnectError } from './errors.js';
import { createAscJwt, type AscCredentials } from './jwt.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type AppStoreConnectClientConfig = {
  credentials: AscCredentials;
  /** Overridable for tests only — production always uses the real App Store Connect API. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Total attempts including the first, not additional retries on top of it. */
  maxAttempts?: number;
  /** Per-attempt timeout — a single slow attempt is aborted and retried, not left to hang. */
  timeoutMs?: number;
  /** Base of the exponential backoff between retries, before jitter. */
  baseDelayMs?: number;
  /** Upper bound on any single computed backoff delay. */
  maxDelayMs?: number;
};

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

const DEFAULT_BASE_URL = 'https://api.appstoreconnect.apple.com/v1';
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;
/** Regenerate the cached JWT once less than this much of its lifetime remains, not on every call. */
const JWT_REFRESH_MARGIN_SECONDS = 60;

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, `${baseUrl}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Apple's documented Retry-After takes precedence over our own computed backoff when present. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const jittered = exponential * (0.5 + Math.random() * 0.5);
  return Math.min(jittered, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AppStoreConnectClient {
  private readonly credentials: AscCredentials;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private cachedJwt?: { token: string; expiresAtSeconds: number };

  constructor(config: AppStoreConnectClientConfig) {
    this.credentials = config.credentials;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  }

  private authToken(): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (this.cachedJwt && this.cachedJwt.expiresAtSeconds - nowSeconds > JWT_REFRESH_MARGIN_SECONDS) {
      return this.cachedJwt.token;
    }
    const token = createAscJwt(this.credentials, nowSeconds);
    this.cachedJwt = { token, expiresAtSeconds: nowSeconds + 20 * 60 };
    return token;
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(this.baseUrl, path, options.query);
    let lastError: AppStoreConnectError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, {
          method,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.authToken()}`,
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });

        if (!response.ok) {
          const responseBody = await safeReadBody(response);
          const error = new AppStoreConnectError('HTTP_ERROR', `App Store Connect API returned ${response.status} for ${method} ${path}`, {
            status: response.status,
            responseBody,
          });
          if (!isRetryableStatus(response.status) || attempt === this.maxAttempts) {
            throw error;
          }
          lastError = error;
          await sleep(retryAfterMs(response) ?? backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
          continue;
        }

        if (response.status === 204) return undefined as T;
        try {
          return (await response.json()) as T;
        } catch (cause) {
          throw new AppStoreConnectError('INVALID_RESPONSE', `App Store Connect API returned a non-JSON response for ${method} ${path}`, { cause });
        }
      } catch (cause) {
        if (cause instanceof AppStoreConnectError) throw cause;
        const isTimeout = cause instanceof Error && cause.name === 'AbortError';
        const error = new AppStoreConnectError(
          isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          isTimeout
            ? `App Store Connect API request timed out after ${this.timeoutMs}ms for ${method} ${path}`
            : `App Store Connect API request failed for ${method} ${path}: ${(cause as Error).message}`,
          { cause },
        );
        if (attempt === this.maxAttempts) throw error;
        lastError = error;
        await sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
      } finally {
        clearTimeout(timeout);
      }
    }

    // Unreachable in practice (the loop always throws or returns on its last attempt),
    // but keeps this function's return type honest for the type checker.
    throw lastError ?? new AppStoreConnectError('NETWORK_ERROR', `App Store Connect API request failed for ${method} ${path}`);
  }
}

async function safeReadBody(response: Response): Promise<unknown> {
  // Cloned first: .json() consumes the body stream, so a non-JSON error body would
  // otherwise make the .text() fallback below throw "body already used" instead of
  // actually recovering the text.
  const clone = response.clone();
  try {
    return await response.json();
  } catch {
    try {
      return await clone.text();
    } catch {
      return undefined;
    }
  }
}
