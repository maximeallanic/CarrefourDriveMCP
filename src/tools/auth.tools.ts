import { z } from 'zod';
import { sessionService } from '../services/session.service.js';
import { carrefourService } from '../services/carrefour.service.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerAuthTools(server: McpServer): void {
  // Set cookies from browser
  server.tool(
    'carrefour_set_cookies',
    'Import cookies from browser to authenticate with Carrefour. Get cookies from DevTools (F12) → Application → Cookies → carrefour.fr',
    {
      cookies: z
        .string()
        .describe(
          'Cookies as JSON object {"cookie_name": "cookie_value", ...} or as cookie string "name1=value1; name2=value2"'
        ),
    },
    async ({ cookies }) => {
      try {
        let cookieObj: Record<string, string>;

        // Try to parse as JSON first
        try {
          cookieObj = JSON.parse(cookies);
        } catch {
          // Parse as cookie string
          cookieObj = {};
          const pairs = cookies.split(';').map((p) => p.trim());
          for (const pair of pairs) {
            const [name, ...valueParts] = pair.split('=');
            if (name && valueParts.length > 0) {
              cookieObj[name.trim()] = valueParts.join('=').trim();
            }
          }
        }

        if (Object.keys(cookieObj).length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Error: No valid cookies provided. Please provide cookies as JSON object or cookie string.',
              },
            ],
          };
        }

        await sessionService.setCookies(cookieObj);

        // Validate the session
        const sessionCheck = await carrefourService.checkSession();

        return {
          content: [
            {
              type: 'text' as const,
              text: sessionCheck.valid
                ? `Cookies imported successfully. Session is valid. ${Object.keys(cookieObj).length} cookies stored.`
                : `Cookies imported but session validation failed: ${sessionCheck.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error importing cookies: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Check session validity
  server.tool(
    'carrefour_check_session',
    'Check if the current Carrefour session is valid',
    {},
    async () => {
      try {
        const result = await carrefourService.checkSession();
        const store = await sessionService.getStore();

        let message = result.message;
        if (result.valid && store) {
          message += `\nSelected store: ${store.name} (ID: ${store.id})`;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: message,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error checking session: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  // Clear session
  server.tool(
    'carrefour_clear_session',
    'Clear all stored Carrefour cookies and session data',
    {},
    async () => {
      try {
        await sessionService.clearSession();
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Session cleared successfully. You will need to import cookies again to use Carrefour features.',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error clearing session: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}
