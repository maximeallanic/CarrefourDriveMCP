import type { HttpRequestConfig } from '../types/index.js';
import { sessionService } from './session.service.js';
import { logger } from '../utils/logger.js';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS || '10', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const MIN_DELAY_MS = parseInt(process.env.MIN_DELAY_MS || '100', 10);
const MAX_DELAY_MS = parseInt(process.env.MAX_DELAY_MS || '500', 10);

class HttpService {
  private requestTimestamps: number[] = [];
  private lastRequestTime: number = 0;

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Clean old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );

    // Check if we've hit the rate limit
    if (this.requestTimestamps.length >= RATE_LIMIT_REQUESTS) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp);
      if (waitTime > 0) {
        logger.info(`Rate limit reached, waiting ${waitTime}ms`);
        await this.sleep(waitTime);
      }
    }

    // Add random delay between requests
    const timeSinceLastRequest = now - this.lastRequestTime;
    const randomDelay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    if (timeSinceLastRequest < randomDelay) {
      await this.sleep(randomDelay - timeSinceLastRequest);
    }

    this.requestTimestamps.push(Date.now());
    this.lastRequestTime = Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async request<T>(config: HttpRequestConfig): Promise<T> {
    await this.waitForRateLimit();

    const cookieString = await sessionService.getCookieString();

    const headers: Record<string, string> = {
      'User-Agent': DEFAULT_USER_AGENT,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      ...config.headers,
    };

    if (cookieString) {
      headers['Cookie'] = cookieString;
    }

    if (config.body && config.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }

    const fetchConfig: RequestInit = {
      method: config.method,
      headers,
      body: config.body ? JSON.stringify(config.body) : undefined,
    };

    logger.info(`HTTP ${config.method} ${config.url}`);

    try {
      const controller = new AbortController();
      const timeout = config.timeout || 30000;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(config.url, {
        ...fetchConfig,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update session cookies from response if present
      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        await this.handleSetCookie(setCookieHeader);
      }

      const contentType = response.headers.get('content-type');
      let data: T;

      if (contentType?.includes('application/json')) {
        data = (await response.json()) as T;
      } else {
        data = (await response.text()) as unknown as T;
      }

      if (!response.ok) {
        logger.error(`HTTP error: ${response.status} ${response.statusText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await sessionService.updateLastUsed();
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      logger.error('HTTP request failed:', error);
      throw error;
    }
  }

  private async handleSetCookie(setCookieHeader: string): Promise<void> {
    try {
      const existingCookies = (await sessionService.getCookies()) || {};
      const newCookies = { ...existingCookies };

      // Parse Set-Cookie header (simplified)
      const cookieParts = setCookieHeader.split(',');
      for (const part of cookieParts) {
        const [cookiePair] = part.split(';');
        const [name, value] = cookiePair.trim().split('=');
        if (name && value) {
          newCookies[name] = value;
        }
      }

      await sessionService.setCookies(newCookies);
    } catch (error) {
      logger.error('Failed to handle Set-Cookie header:', error);
    }
  }

  async get<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'GET', url, headers });
  }

  async post<T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'POST', url, body, headers });
  }

  async put<T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'PUT', url, body, headers });
  }

  async delete<T>(url: string, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'DELETE', url, headers });
  }

  async patch<T>(url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: 'PATCH', url, body, headers });
  }
}

export const httpService = new HttpService();
