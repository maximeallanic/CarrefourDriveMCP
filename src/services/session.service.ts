import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { dirname, resolve } from 'path';
import { CookieJar, Cookie } from 'tough-cookie';
import { logger } from '../utils/logger.js';
import { dataPath } from '../utils/paths.js';
import { lentMode } from './bridge.protocol.js';
import { hostBrowser } from './host-browser.js';

/** Where the lent-browser mode reads which cookies the host holds: their names, never a value. */
export interface CookieNamesSource {
  cookieNames(origin: string): Promise<string[]>;
}

export const CARREFOUR_ORIGIN = 'https://www.carrefour.fr';
/** ForgeRock AM lives on its own host and holds the SSO session. */
export const IAM_ORIGIN = 'https://moncompte.carrefour.fr';
/** Name of the ForgeRock SSO cookie, from /iam/json/serverinfo/*. */
export const SSO_COOKIE_NAME = 'c4iamsecuretk';

/** Node exposes multiple `Set-Cookie` values only through `getSetCookie()`. */
export function getSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === 'function') return withGetter.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function sessionFile(): string {
  return process.env.CARREFOUR_SESSION_FILE
    ? resolve(process.env.CARREFOUR_SESSION_FILE)
    : dataPath('sessions', 'cookies.json');
}

export interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number | string;
  secure?: boolean;
  httpOnly?: boolean;
}

/**
 * Parse the three cookie shapes a user can realistically produce:
 *  1. a raw `Cookie:` header  -> "a=1; b=2"
 *  2. a JSON map              -> {"a": "1", "b": "2"}
 *  3. a JSON array of objects -> Playwright / EditThisCookie / DevTools export
 */
export function parseCookieInput(input: string): CookieInput[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      return parsed
        .filter((c): c is CookieInput => !!c && typeof (c as CookieInput).name === 'string')
        .map((c) => ({ ...c, value: String(c.value ?? '') }));
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({
        name,
        value: String(value),
      }));
    }
  }

  // Fall back to a cookie header string.
  return trimmed
    .split(';')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      if (idx < 0) return null;
      return { name: pair.slice(0, idx).trim(), value: pair.slice(idx + 1).trim() };
    })
    .filter((c): c is CookieInput => c !== null && c.name.length > 0);
}

export class SessionService {
  private jar = new CookieJar();
  private loaded = false;
  /**
   * Lent-browser mode (`bridge.protocol.ts`): the session is the host's. No jar is read or written,
   * and what is known of the session is the cookie NAMES the host holds per origin, refreshed by
   * `ready()` — enough for `hasSession()` and `hasSso()`, never a value.
   */
  private readonly host: CookieNamesSource | null;
  private hostNames = new Map<string, string[]>();

  constructor(opts: { host?: CookieNamesSource | null } = {}) {
    this.host = opts.host ?? null;
  }

  isLent(): boolean {
    return this.host !== null;
  }

  /** Lent mode: asks the host which cookies it holds for the storefront and the SSO. Otherwise nothing to do. */
  async ready(): Promise<void> {
    if (!this.host) return;
    for (const origin of [CARREFOUR_ORIGIN, IAM_ORIGIN]) {
      this.hostNames.set(origin, await this.host.cookieNames(origin));
    }
  }

  private namesFor(url: string): string[] {
    try {
      return this.hostNames.get(new URL(url).origin) ?? [];
    } catch {
      return [];
    }
  }

  /** Whether any cookie is held for `url` — the only thing a cookie header was used to decide. */
  hasCookiesFor(url: string = CARREFOUR_ORIGIN): boolean {
    return this.host ? this.namesFor(url).length > 0 : this.getCookieHeader(url).length > 0;
  }

  /** Load the persisted jar, then layer any env-provided cookies on top. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (this.host) return;

    const file = sessionFile();
    if (existsSync(file)) {
      try {
        this.jar = CookieJar.deserializeSync(JSON.parse(readFileSync(file, 'utf8')));
        logger.info('Cookie jar loaded from disk', { file });
      } catch (error) {
        logger.error('Failed to load cookie jar, starting empty', { error: String(error) });
        this.jar = new CookieJar();
      }
    }

    const envFile = process.env.CARREFOUR_COOKIE_FILE;
    if (envFile && existsSync(resolve(envFile))) {
      try {
        this.importCookies(readFileSync(resolve(envFile), 'utf8'), false);
        logger.info('Cookies imported from CARREFOUR_COOKIE_FILE', { file: envFile });
      } catch (error) {
        logger.error('Failed to read CARREFOUR_COOKIE_FILE', { error: String(error) });
      }
    }

    if (process.env.CARREFOUR_COOKIES) {
      try {
        this.importCookies(process.env.CARREFOUR_COOKIES, false);
        logger.info('Cookies imported from CARREFOUR_COOKIES');
      } catch (error) {
        logger.error('Failed to parse CARREFOUR_COOKIES', { error: String(error) });
      }
    }
  }

  /** Add cookies from any supported input format. Returns how many were stored. */
  importCookies(input: string, persist = true): number {
    if (this.host) return 0;
    this.ensureLoaded();
    const cookies = parseCookieInput(input);
    let stored = 0;

    for (const c of cookies) {
      const domain = (c.domain || 'www.carrefour.fr').replace(/^\./, '');
      const path = c.path || '/';
      const cookie = new Cookie({
        key: c.name,
        value: c.value,
        domain,
        path,
        secure: c.secure ?? true,
        httpOnly: c.httpOnly ?? false,
      });
      try {
        this.jar.setCookieSync(cookie, `https://${domain}${path}`, { ignoreError: false });
        stored += 1;
      } catch (error) {
        logger.error('Rejected cookie', { name: c.name, error: String(error) });
      }
    }

    if (persist && stored > 0) this.persist();
    return stored;
  }

  /** The jar in Playwright's `addCookies` shape, to seed a browser profile. */
  toPlaywrightCookies(): Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    expires?: number;
  }> {
    this.ensureLoaded();
    if (this.host) return [];
    const out = [];
    for (const origin of [CARREFOUR_ORIGIN, IAM_ORIGIN]) {
      for (const cookie of this.jar.getCookiesSync(origin)) {
        const expiry = cookie.expiryTime();
        out.push({
          name: cookie.key,
          value: cookie.value,
          domain: cookie.domain ?? new URL(origin).hostname,
          path: cookie.path ?? '/',
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          // Playwright wants seconds; -1 means "session cookie".
          expires: Number.isFinite(expiry) ? Math.floor(expiry / 1000) : -1,
        });
      }
    }
    return out;
  }

  /** Serialize the jar to disk with owner-only permissions. */
  persist(): void {
    if (this.host) return;
    const file = sessionFile();
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(this.jar.serializeSync(), null, 2), { mode: 0o600 });
      chmodSync(file, 0o600);
    } catch (error) {
      logger.error('Failed to persist cookie jar', { error: String(error) });
    }
  }

  getCookieHeader(url: string = CARREFOUR_ORIGIN): string {
    this.ensureLoaded();
    try {
      return this.jar.getCookieStringSync(url);
    } catch (error) {
      logger.error('Failed to read cookies for url', { url, error: String(error) });
      return '';
    }
  }

  /** Fold `Set-Cookie` response headers back into the jar. */
  storeSetCookies(setCookies: string[], url: string): void {
    if (setCookies.length === 0 || this.host) return;
    this.ensureLoaded();
    for (const raw of setCookies) {
      try {
        this.jar.setCookieSync(raw, url, { ignoreError: true });
      } catch {
        // Malformed Set-Cookie values from the site are not worth failing on.
      }
    }
    this.persist();
  }

  hasSession(): boolean {
    return this.hasCookiesFor(CARREFOUR_ORIGIN);
  }

  /** The SSO token is what lets us rebuild an expired storefront session. */
  getSsoToken(): string | null {
    if (this.host) return null;
    this.ensureLoaded();
    try {
      const found = this.jar.getCookiesSync(IAM_ORIGIN).find((c) => c.key === SSO_COOKIE_NAME);
      return found?.value ?? null;
    } catch (error) {
      logger.error('Failed to read the SSO cookie', { error: String(error) });
      return null;
    }
  }

  hasSso(): boolean {
    if (this.host) return this.namesFor(IAM_ORIGIN).includes(SSO_COOKIE_NAME);
    return this.getSsoToken() !== null;
  }

  cookieNames(url: string = CARREFOUR_ORIGIN): string[] {
    if (this.host) return [...this.namesFor(url)].sort();
    this.ensureLoaded();
    return this.jar
      .getCookiesSync(url)
      .map((c) => c.key)
      .sort();
  }

  clear(): void {
    if (this.host) return;
    this.jar = new CookieJar();
    this.loaded = true;
    const file = sessionFile();
    if (existsSync(file)) {
      try {
        unlinkSync(file);
      } catch (error) {
        logger.error('Failed to delete session file', { error: String(error) });
      }
    }
  }

  status(): {
    authenticated: boolean;
    cookieCount: number;
    cookies: string[];
    sso: boolean;
    sessionFile: string;
  } {
    const cookies = this.cookieNames();
    return {
      authenticated: cookies.length > 0,
      cookieCount: cookies.length,
      cookies,
      sso: this.hasSso(),
      sessionFile: this.host ? 'held by the host' : sessionFile(),
    };
  }
}

export const sessionService = new SessionService(lentMode() ? { host: hostBrowser() } : {});

/** What a tool says when no session can be used — in the lent mode, the session is the host's to renew. */
export const LENT_NO_SESSION_MESSAGE = [
  'No Carrefour session is held by the host that lends this server its browser, or it has expired.',
  '',
  'Ask the account owner to export his carrefour.fr session again from his own browser (www.carrefour.fr',
  `and moncompte.carrefour.fr, including the '${SSO_COOKIE_NAME}' cookie); the host records it with`,
  'browser.add_identity, under the identity lent to this server.',
].join('\n');

export function noSessionMessage(session: SessionService = sessionService): string {
  return session.isLent() ? LENT_NO_SESSION_MESSAGE : NO_SESSION_MESSAGE;
}

export const NO_SESSION_MESSAGE = [
  'No Carrefour session available.',
  '',
  'This tool needs an authenticated www.carrefour.fr session. Provide one of:',
  '  1. Call `carrefour_browser_login` (needs playwright) and sign in in the window that',
  '     opens — Carrefour gates the login with a captcha and an email OTP, so this step',
  '     cannot be automated.',
  '  2. Call `carrefour_set_cookies` with your cookies (JSON map, JSON array, or a raw',
  '     "name=value; name=value" cookie header copied from DevTools).',
  '  3. Set CARREFOUR_COOKIES in the environment / .env file.',
  '  4. Set CARREFOUR_COOKIE_FILE to a JSON cookie export (Playwright/EditThisCookie format).',
  '',
  `Include the '${SSO_COOKIE_NAME}' cookie from moncompte.carrefour.fr: it is the only way the`,
  'server can renew an expired storefront session on its own. Without it, every expiry',
  'needs a fresh manual login.',
].join('\n');
