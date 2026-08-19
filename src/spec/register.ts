import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildRequest } from './resolve.js';
import { schemaToZodShape } from './params.js';
import type { ToolSpec } from './types.js';
import { loadToolSpecs, type LoadResult } from './loader.js';
import { httpService } from '../services/http.service.js';
import { sessionService, NO_SESSION_MESSAGE } from '../services/session.service.js';
import { logger } from '../utils/logger.js';

const MAX_RESPONSE_CHARS = parseInt(process.env.CARREFOUR_MAX_RESPONSE_CHARS || '60000', 10);

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function text(body: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text: body }], isError };
}

function render(data: unknown): string {
  const out = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (out.length <= MAX_RESPONSE_CHARS) return out;
  return `${out.slice(0, MAX_RESPONSE_CHARS)}\n\n[truncated: ${out.length} chars total — refine your query or raise CARREFOUR_MAX_RESPONSE_CHARS]`;
}

/** Execute one declarative tool. Exported so the smoke test can drive it directly. */
export async function executeSpec(spec: ToolSpec, args: Record<string, unknown>): Promise<ToolResult> {
  // An SSO cookie alone is enough: httpService rebuilds the storefront session
  // before the request goes out.
  if (spec.requires_auth && !sessionService.hasSession() && !sessionService.hasSso()) {
    return text(NO_SESSION_MESSAGE, true);
  }

  let request;
  try {
    request = buildRequest(spec, args);
  } catch (error) {
    return text(`Could not build the request for "${spec.name}": ${(error as Error).message}`, true);
  }

  try {
    const result = await httpService.send(request, { withAuth: spec.requires_auth !== false });

    if (result.status === 401 || result.status === 403) {
      // httpService already tried to refresh and replay this request, so
      // reaching here means the session is really gone.
      return text(
        `Carrefour returned ${result.status} for ${spec.name}. The session is expired and could not be ` +
          `renewed automatically.\n\n${NO_SESSION_MESSAGE}`,
        true
      );
    }

    if (!result.ok) {
      return text(
        `HTTP ${result.status} ${result.statusText} on ${request.method} ${request.url}\n\n${render(result.data)}`,
        true
      );
    }

    return text(render(result.data));
  } catch (error) {
    logger.error('Tool execution failed', { tool: spec.name, error: String(error) });
    return text(`Request failed for "${spec.name}": ${(error as Error).message}`, true);
  }
}

/**
 * Register every JSON-declared tool on the MCP server.
 * All 43 endpoints are served by this one generic executor.
 */
export function registerSpecTools(server: McpServer, load: LoadResult = loadToolSpecs()): LoadResult {
  for (const spec of load.specs) {
    const shape = schemaToZodShape(spec.parameters);
    const description = spec.requires_auth
      ? `${spec.description} (requires an authenticated Carrefour session)`
      : spec.description;

    server.tool(spec.name, description, shape, async (args: Record<string, unknown>) =>
      executeSpec(spec, args ?? {})
    );
  }

  for (const failure of load.failures) {
    logger.error('Skipped tool definition', failure);
  }

  return load;
}
