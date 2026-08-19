import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  sessionService,
  NO_SESSION_MESSAGE,
  CARREFOUR_ORIGIN,
  IAM_ORIGIN,
  SSO_COOKIE_NAME,
} from '../services/session.service.js';
import { httpService } from '../services/http.service.js';
import { refreshSession, ssoStatus } from '../services/auth.service.js';
import { browserLogin, isPlaywrightAvailable } from '../services/browser-login.js';
import { browserService } from '../services/browser.service.js';

function humanDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function text(body: string, isError = false) {
  return { content: [{ type: 'text' as const, text: body }], isError };
}

/** Endpoint used as a cheap "am I logged in?" probe. */
const PROBE_URL = `${CARREFOUR_ORIGIN}/api/user/secured/loyalty/balance`;

export function registerSessionTools(server: McpServer): void {
  server.tool(
    'carrefour_set_cookies',
    'Store your www.carrefour.fr session cookies so the other tools can act on your account. ' +
      'Accepts a raw cookie header ("a=1; b=2"), a JSON map, or a JSON array export ' +
      '(Playwright / EditThisCookie / DevTools). Get them from DevTools (F12) > Application > Cookies > https://www.carrefour.fr.',
    {
      cookies: z.string().describe('Cookies as a header string, a JSON object, or a JSON array of cookie objects.'),
    },
    async ({ cookies }) => {
      const stored = sessionService.importCookies(cookies);
      if (stored === 0) {
        return text('No usable cookie found in the provided value.', true);
      }
      const status = sessionService.status();
      const sso = status.sso
        ? `IAM SSO cookie (${SSO_COOKIE_NAME}) present: the session can renew itself automatically.`
        : `No '${SSO_COOKIE_NAME}' cookie (moncompte.carrefour.fr) — the session cannot renew itself, ` +
          'and you will have to sign in again by hand once it expires.';
      return text(
        `Stored ${stored} cookie(s). Session file: ${status.sessionFile}\n` +
          `Cookies: ${status.cookies.join(', ')}\n${sso}`
      );
    }
  );

  server.tool(
    'carrefour_session_status',
    'Report whether a Carrefour session is stored locally, and optionally verify it against the site.',
    {
      verify: z
        .boolean()
        .optional()
        .describe('If true, performs one authenticated request to check the session is still valid.'),
    },
    async ({ verify }) => {
      const status = sessionService.status();
      if (!status.authenticated && !status.sso) return text(NO_SESSION_MESSAGE, true);

      const browser = browserService.describe();
      let line =
        `Session present: ${status.cookieCount} cookie(s) [${status.cookies.join(', ')}]\n` +
        `File: ${status.sessionFile}\nBrowser profile: ${browser.profile} (${browser.running ? 'running' : 'stopped'})`;

      const sso = await ssoStatus();
      if (!sso.present) {
        line += `\nIAM SSO: absent — no automatic renewal, expect a manual login when the session dies.`;
      } else if (sso.secondsLeft !== undefined) {
        line +=
          `\nIAM SSO: valid for ${humanDuration(sso.secondsLeft)}` +
          (sso.maxIdleMinutes ? `, dies after ${sso.maxIdleMinutes} min idle` : '') +
          ' — the session renews itself until then.';
      } else {
        line += `\nIAM SSO: cookie stored, but ${IAM_ORIGIN} did not confirm it is still valid.`;
      }

      if (verify) {
        try {
          const result = await httpService.send({
            method: 'GET',
            url: PROBE_URL,
            headers: { accept: 'application/json, text/plain, */*', 'x-requested-with': 'XMLHttpRequest' },
          });
          line +=
            result.status === 401 || result.status === 403
              ? `\nVerification: FAILED (HTTP ${result.status}) — the session looks expired.`
              : `\nVerification: HTTP ${result.status}`;
        } catch (error) {
          line += `\nVerification: could not reach carrefour.fr (${(error as Error).message})`;
        }
      }
      return text(line);
    }
  );

  server.tool(
    'carrefour_refresh_session',
    'Force a renewal of the www.carrefour.fr session from the stored IAM SSO cookie. ' +
      'Rarely needed by hand: authenticated requests already refresh and retry on their own.',
    {},
    async () => {
      const result = await refreshSession();
      if (!result.ok) return text(result.message, true);
      const status = sessionService.status();
      return text(`${result.message}\nCookies now held for ${CARREFOUR_ORIGIN}: ${status.cookies.join(', ')}`);
    }
  );

  server.tool('carrefour_clear_session', 'Delete the locally stored Carrefour cookies.', {}, async () => {
    await browserService.close();
    sessionService.clear();
    return text('Session cleared. Provide cookies again with carrefour_set_cookies before using account tools.');
  });

  // Optional convenience: only exposed when playwright happens to be installed.
  if (isPlaywrightAvailable()) {
    server.tool(
      'carrefour_browser_login',
      'Opens a browser window on the server profile so you can sign in to carrefour.fr. ' +
        'Finish the captcha and the emailed OTP, then close the window: the session — including the ' +
        'IAM SSO cookie that lets the server renew itself — stays in the profile. ' +
        'The login cannot be automated: Cloudflare Turnstile refuses to validate in a driven browser.',
      {},
      async () => {
        try {
          return text(await browserLogin({}));
        } catch (error) {
          return text(`Browser login failed: ${(error as Error).message}`, true);
        }
      }
    );
  }
}
