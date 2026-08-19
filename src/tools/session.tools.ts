import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { sessionService, NO_SESSION_MESSAGE, CARREFOUR_ORIGIN } from '../services/session.service.js';
import { httpService } from '../services/http.service.js';
import { browserLogin, isPlaywrightAvailable } from '../services/browser-login.js';

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
      return text(
        `Stored ${stored} cookie(s). Session file: ${status.sessionFile}\nCookies: ${status.cookies.join(', ')}`
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
      if (!status.authenticated) return text(NO_SESSION_MESSAGE, true);

      let line = `Session present: ${status.cookieCount} cookie(s) [${status.cookies.join(', ')}]\nFile: ${status.sessionFile}`;
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

  server.tool('carrefour_clear_session', 'Delete the locally stored Carrefour cookies.', {}, async () => {
    sessionService.clear();
    return text('Session cleared. Provide cookies again with carrefour_set_cookies before using account tools.');
  });

  // Optional convenience: only exposed when playwright happens to be installed.
  if (isPlaywrightAvailable()) {
    server.tool(
      'carrefour_browser_login',
      'OPTIONAL. Opens a real browser (Playwright) to log into carrefour.fr and captures the session cookies. ' +
        'Not required — carrefour_set_cookies works without any browser.',
      {
        email: z.string().optional().describe('Account email. Omit to log in manually in the opened window.'),
        password: z.string().optional().describe('Account password. Omit to log in manually.'),
        headless: z.boolean().optional().describe('Run without a visible window (default: false).'),
      },
      async ({ email, password, headless }) => {
        try {
          return text(await browserLogin({ email, password, headless }));
        } catch (error) {
          return text(`Browser login failed: ${(error as Error).message}`, true);
        }
      }
    );
  }
}
