import type { BuiltRequest } from '../spec/types.js';
import { sessionService } from './session.service.js';
import { logger } from '../utils/logger.js';

const DEFAULT_USER_AGENT =
  process.env.CARREFOUR_USER_AGENT ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '10', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const MIN_DELAY_MS = parseInt(process.env.MIN_DELAY_MS || '100', 10);
const MAX_DELAY_MS = parseInt(process.env.MAX_DELAY_MS || '500', 10);
const TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);

export interface HttpResult {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  contentType: string | null;
  data: unknown;
}

function getSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') return withGetter.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

class HttpService {
  private requestTimestamps: number[] = [];
  private lastRequestTime = 0;

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Simple sliding-window limiter plus a small jitter between calls. */
  private async throttle(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

    if (this.requestTimestamps.length >= RATE_LIMIT_REQUESTS) {
      const wait = RATE_LIMIT_WINDOW_MS - (now - this.requestTimestamps[0]);
      if (wait > 0) {
        logger.info('Rate limit reached, waiting', { waitMs: wait });
        await this.sleep(wait);
      }
    }

    const sinceLast = Date.now() - this.lastRequestTime;
    const jitter = MIN_DELAY_MS + Math.random() * Math.max(0, MAX_DELAY_MS - MIN_DELAY_MS);
    if (sinceLast < jitter) await this.sleep(jitter - sinceLast);

    this.requestTimestamps.push(Date.now());
    this.lastRequestTime = Date.now();
  }

  async send(request: BuiltRequest, opts: { withAuth: boolean } = { withAuth: true }): Promise<HttpResult> {
    await this.throttle();

    const headers: Record<string, string> = {
      'user-agent': DEFAULT_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: 'https://www.carrefour.fr/',
      origin: 'https://www.carrefour.fr',
      ...request.headers,
    };

    if (opts.withAuth) {
      const cookie = sessionService.getCookieHeader(request.url);
      if (cookie) headers.cookie = cookie;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    logger.info('HTTP request', { method: request.method, url: request.url });

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.body as BodyInit | undefined,
        signal: controller.signal,
        redirect: 'follow',
      });

      sessionService.storeSetCookies(getSetCookies(response.headers), request.url);

      const contentType = response.headers.get('content-type');
      const text = await response.text();
      let data: unknown = text;
      if (contentType?.includes('json')) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      logger.info('HTTP response', { status: response.status, url: request.url });

      return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url || request.url,
        contentType,
        data,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timed out after ${TIMEOUT_MS}ms: ${request.method} ${request.url}`);
      }
      logger.error('HTTP request failed', { error: String(error), url: request.url });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const httpService = new HttpService();
