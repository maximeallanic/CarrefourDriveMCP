import { mkdirSync } from 'fs';
import { resolve } from 'path';
import type { BrowserContext, Page } from 'playwright';
import { sessionService } from './session.service.js';
import { logger } from '../utils/logger.js';
import { dataPath } from '../utils/paths.js';

/**
 * All Carrefour traffic goes through a real Chromium.
 *
 * carrefour.fr sits behind a Cloudflare managed challenge that fingerprints the
 * client: `fetch` (undici) is answered with `403 cf-mitigated: challenge` from
 * the very first request, and plain `curl` is challenged after a handful — from
 * the same IP where Chrome gets a clean `200`. No amount of header spoofing
 * fixes that, so the only viable transport is a browser, and the requests must
 * be issued *inside a page*: Playwright's own APIRequestContext uses a Node HTTP
 * stack and is challenged just like `fetch`.
 *
 * Measured on 2026-08-19:
 *
 *   headless shell                                  -> 403 (UA says HeadlessChrome)
 *   channel 'chromium', headless                    -> 403 (idem)
 *   headed                                          -> 200
 *   channel 'chromium', headless + masked UA
 *     + --disable-blink-features=AutomationControlled -> 200
 *
 * The last line is what this service launches: no window, and it passes.
 */

/** A stock Chrome UA — the default one leaks `HeadlessChrome` and gets blocked. */
const USER_AGENT =
  process.env.CARREFOUR_USER_AGENT ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

const NAV_TIMEOUT_MS = parseInt(process.env.CARREFOUR_NAV_TIMEOUT_MS || '60000', 10);

/**
 * Where to park a page per origin. The root of the IAM host answers with
 * ERR_ABORTED, so parking there leaves the page on about:blank and every
 * same-origin fetch fails; its login UI loads cleanly instead.
 */
const PARKING_PATH: Record<string, string> = {
  'https://moncompte.carrefour.fr': '/iam/XUI/',
};

function parkingUrl(origin: string): string {
  return `${origin}${PARKING_PATH[origin] ?? '/'}`;
}

export function profileDir(): string {
  return process.env.CARREFOUR_BROWSER_PROFILE
    ? resolve(process.env.CARREFOUR_BROWSER_PROFILE)
    : dataPath('browser-profile');
}

export interface FetchRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** multipart/form-data payloads, rebuilt as a FormData inside the page. */
  formEntries?: Array<[string, string]>;
}

export interface FetchResponse {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  contentType: string | null;
  text: string;
}

class BrowserService {
  private context: BrowserContext | null = null;
  private headed = false;
  private starting: Promise<BrowserContext> | null = null;
  /** One parked page per origin: an in-page fetch is subject to CORS. */
  private pages = new Map<string, Page>();

  isRunning(): boolean {
    return this.context !== null;
  }

  private async launch(headless: boolean): Promise<BrowserContext> {
    const dir = profileDir();
    mkdirSync(dir, { recursive: true });

    // Imported at call time so the module graph stays loadable without playwright.
    const { chromium } = await import('playwright');

    const context = await chromium.launchPersistentContext(dir, {
      headless,
      // The full browser, not the headless shell: the shell is fingerprinted.
      channel: 'chromium',
      userAgent: USER_AGENT,
      args: ['--disable-blink-features=AutomationControlled'],
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      viewport: { width: 1366, height: 900 },
    });
    context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // Seed the profile with anything the user imported by hand or via the env.
    const seeded = sessionService.toPlaywrightCookies();
    if (seeded.length > 0) {
      await context.addCookies(seeded).catch((error) => {
        logger.error('Could not seed the browser with the stored cookies', { error: String(error) });
      });
    }

    this.headed = headless === false;
    logger.info('Browser started', { headless, profile: dir });
    return context;
  }

  /** The persistent profile can only be opened once, so launches are serialised. */
  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (!this.starting) {
      this.starting = this.launch(true)
        .then((context) => {
          this.context = context;
          context.on('close', () => {
            this.context = null;
            this.pages.clear();
          });
          return context;
        })
        .finally(() => {
          this.starting = null;
        });
    }
    return this.starting;
  }

  /**
   * A page parked on `origin`, so that a fetch from it is same-origin.
   * Re-navigates when the site moved the page from under us.
   */
  private async pageFor(origin: string): Promise<Page> {
    const context = await this.ensureContext();
    const existing = this.pages.get(origin);
    if (existing && !existing.isClosed()) {
      if (new URL(existing.url()).origin === origin) return existing;
      await existing.goto(parkingUrl(origin), { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      return existing;
    }

    const page = context.pages().find((p) => !p.isClosed() && !this.isParked(p)) ?? (await context.newPage());
    // A 404 is fine: all we need from the navigation is the origin.
    await page.goto(parkingUrl(origin), { waitUntil: 'domcontentloaded' }).catch((error) => {
      logger.error('Could not park a page on the origin', { origin, error: String(error) });
    });
    this.pages.set(origin, page);
    return page;
  }

  private isParked(page: Page): boolean {
    for (const parked of this.pages.values()) if (parked === page) return true;
    return false;
  }

  /** Issue one request from inside the page, i.e. through Chromium's own stack. */
  async fetch(request: FetchRequest): Promise<FetchResponse> {
    const origin = new URL(request.url).origin;

    const run = async (): Promise<FetchResponse> => {
      const page = await this.pageFor(origin);
      const result = await page.evaluate(async (req) => {
        let body: BodyInit | undefined = req.body;
        if (req.formEntries) {
          const form = new FormData();
          for (const [key, value] of req.formEntries) form.append(key, value);
          body = form;
        }
        const response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body,
          credentials: 'include',
        });
        return {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          url: response.url,
          contentType: response.headers.get('content-type'),
          text: await response.text(),
        };
      }, request);
      return result as FetchResponse;
    };

    try {
      return await run();
    } catch (error) {
      // A navigation can tear down the execution context mid-call; re-park once.
      logger.info('In-page fetch failed, re-parking the page and retrying', {
        url: request.url,
        error: String(error),
      });
      const stale = this.pages.get(origin);
      if (stale && !stale.isClosed()) await stale.close().catch(() => undefined);
      this.pages.delete(origin);
      return run();
    }
  }

  /** Drive a real navigation — used for the OAuth redirect chain. */
  async navigate(url: string): Promise<{ status: number | null; finalUrl: string }> {
    const page = await this.pageFor(new URL(url).origin);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.syncCookies();
    return { status: response?.status() ?? null, finalUrl: page.url() };
  }

  /** Mirror the browser's cookies back into the jar so status/refresh can read them. */
  async syncCookies(): Promise<void> {
    try {
      const context = await this.ensureContext();
      const cookies = await context.cookies();
      if (cookies.length > 0) sessionService.importCookies(JSON.stringify(cookies));
    } catch (error) {
      logger.error('Could not read the browser cookies', { error: String(error) });
    }
  }

  /**
   * Run `work` in a visible browser. The persistent profile allows a single
   * instance, so the headless context is closed and reopened around it.
   */
  async withHeadedContext<T>(work: (context: BrowserContext) => Promise<T>): Promise<T> {
    await this.close();
    const context = await this.launch(false);
    try {
      return await work(context);
    } finally {
      await context.close().catch(() => undefined);
      this.headed = false;
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.pages.clear();
    if (context) await context.close().catch(() => undefined);
  }

  describe(): { running: boolean; headed: boolean; profile: string } {
    return { running: this.context !== null, headed: this.headed, profile: profileDir() };
  }
}

export const browserService = new BrowserService();
