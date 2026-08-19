import { createRequire } from 'module';
import { spawn } from 'child_process';
import { createServer } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sessionService, SSO_COOKIE_NAME, CARREFOUR_ORIGIN } from './session.service.js';
import { browserService } from './browser.service.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

export function isPlaywrightAvailable(): boolean {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

/** Redirects to the ForgeRock login UI, which bounces back through OAuth2. */
const LOGIN_URL = `${CARREFOUR_ORIGIN}/mon-compte/login`;
const POLL_MS = 2000;

export interface BrowserLoginOptions {
  waitMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/**
 * The DevTools *HTTP* endpoint. Unlike a CDP WebSocket session it does not
 * enable any domain in the page, so polling it does not make the browser look
 * automated — which matters, because Turnstile refuses to validate as soon as
 * something is really attached.
 */
async function openTabs(port: number): Promise<Array<{ type: string; url: string }>> {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  return (await response.json()) as Array<{ type: string; url: string }>;
}

function loggedIn(tabs: Array<{ type: string; url: string }>): boolean {
  return tabs.some((tab) => {
    if (tab.type !== 'page') return false;
    try {
      const url = new URL(tab.url);
      // Back on the storefront means the OAuth round-trip completed.
      return url.origin === CARREFOUR_ORIGIN && !url.pathname.startsWith('/mon-compte/login');
    } catch {
      return false;
    }
  });
}

/**
 * Sign in through a browser window the user drives themselves.
 *
 * Two constraints shape this:
 *
 *  - Cloudflare Turnstile refuses to validate in a CDP-driven browser, so the
 *    window cannot be a Playwright one. It is a plain Chromium process, with a
 *    debugging port opened but nothing attached to it until the login is done.
 *  - `c4iamsecuretk` is a *session* cookie, and Chromium never writes those to
 *    disk. Waiting for the window to close would therefore destroy exactly what
 *    we came for, and the on-disk cookies are encrypted with a key that another
 *    Chromium launch may not be able to read anyway.
 *
 * So we watch the tab list over plain HTTP, and the moment the OAuth chain lands
 * back on the storefront we attach, lift the cookies out of the live browser and
 * keep them in the jar — which is what seeds the server's own browser profile on
 * every launch.
 */
export async function browserLogin(opts: BrowserLoginOptions = {}): Promise<string> {
  if (!isPlaywrightAvailable()) {
    throw new Error(
      'Playwright is not installed. Run `npm install playwright && npx playwright install chromium`.'
    );
  }

  const { chromium } = await import('playwright');
  const executable = chromium.executablePath();
  const port = await freePort();
  // A throwaway profile: the server's own profile stays untouched and unlocked.
  const dir = mkdtempSync(join(tmpdir(), 'carrefour-login-'));
  const waitMs = opts.waitMs ?? 900_000;

  const child = spawn(
    executable,
    [
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      LOGIN_URL,
    ],
    { stdio: 'ignore', detached: true }
  );
  child.unref();

  let signedIn = false;
  const deadline = Date.now() + waitMs;
  try {
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      let tabs;
      try {
        tabs = await openTabs(port);
      } catch {
        // Not up yet, or the user closed the window.
        continue;
      }
      if (tabs.length === 0) break;
      if (loggedIn(tabs)) {
        signedIn = true;
        break;
      }
    }

    if (!signedIn) {
      return (
        'The login did not complete: the window never came back to the storefront. Run the tool ' +
        'again, and leave the window open once you are signed in — closing it discards the session.'
      );
    }

    // Only now do we attach: the captcha is behind us.
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    try {
      const cookies = (await Promise.all(browser.contexts().map((context) => context.cookies()))).flat();
      sessionService.importCookies(JSON.stringify(cookies));
      logger.info('Login cookies collected', { count: cookies.length, sso: sessionService.hasSso() });
    } finally {
      await browser.close().catch(() => undefined);
    }
  } finally {
    try {
      process.kill(-child.pid!, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    rmSync(dir, { recursive: true, force: true });
  }

  if (!sessionService.hasSso()) {
    return (
      `Signed in, but no '${SSO_COOKIE_NAME}' cookie came back, so the session will not be able to ` +
      'renew itself. Authenticated tools will work until it expires, then ask you to sign in again.'
    );
  }

  // Hand the fresh cookies to the server's browser, and prove they work.
  await browserService.close();
  await browserService.syncCookies();
  return (
    'Signed in. The IAM SSO cookie is stored, so the session renews itself for up to 24 h and ' +
    'survives a server restart.'
  );
}
