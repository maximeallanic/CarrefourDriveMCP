import { createRequire } from 'module';
import { sessionService } from './session.service.js';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);

/** Playwright is an OPTIONAL dependency: everything else works without it. */
export function isPlaywrightAvailable(): boolean {
  try {
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

const LOGIN_URL = 'https://www.carrefour.fr/mon-compte/connexion';

export interface BrowserLoginOptions {
  email?: string;
  password?: string;
  /** Headed mode lets the user solve captchas / 2FA manually. */
  headless?: boolean;
  waitMs?: number;
}

/**
 * Convenience login flow that drives a real browser and hands the resulting
 * cookies to the session service. Only used when the user explicitly asks for
 * it and `playwright` happens to be installed.
 */
export async function browserLogin(opts: BrowserLoginOptions = {}): Promise<string> {
  if (!isPlaywrightAvailable()) {
    throw new Error(
      'Playwright is not installed. Run `npm install playwright && npx playwright install chromium`, ' +
        'or simply provide your cookies with the `carrefour_set_cookies` tool (no browser needed).'
    );
  }

  const specifier = 'playwright';
  // Non-literal specifier keeps this an optional runtime dependency.
  const playwright: any = await import(specifier);

  const headless = opts.headless ?? false;
  const waitMs = opts.waitMs ?? 120_000;

  const browser = await playwright.chromium.launch({ headless });
  try {
    const context = await browser.newContext({
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
    });
    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Cookie consent banner.
    try {
      const btn = page.locator('#onetrust-accept-btn-handler');
      if (await btn.isVisible({ timeout: 3000 })) await btn.click();
    } catch {
      /* no banner */
    }

    if (opts.email && opts.password) {
      await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 20_000 });
      await page.locator('input[type="email"], input[name="email"], #email').first().fill(opts.email);
      await page
        .locator('input[type="password"], input[name="password"], #password')
        .first()
        .fill(opts.password);
      await page.locator('button[type="submit"]').first().click();
    }

    // Either the scripted login navigates away, or the human finishes it by hand.
    await page
      .waitForURL((url: URL) => !url.href.includes('connexion'), { timeout: waitMs })
      .catch(() => undefined);

    const cookies = await context.cookies();
    const count = sessionService.importCookies(JSON.stringify(cookies));
    logger.info('Browser login finished', { cookies: count });
    return `Stored ${count} cookies from the browser session.`;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
