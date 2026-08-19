#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from 'dotenv';
import { registerSpecTools } from './spec/register.js';
import { loadToolSpecs } from './spec/loader.js';
import { registerSessionTools } from './tools/session.tools.js';
import { logger } from './utils/logger.js';

config();

export function createServer(): { server: McpServer; toolCount: number } {
  const server = new McpServer({ name: 'carrefour-drive', version: '2.0.0' });

  registerSessionTools(server);
  const load = loadToolSpecs();
  registerSpecTools(server, load);

  if (load.failures.length > 0) {
    for (const f of load.failures) {
      process.stderr.write(`[carrefour-drive] skipped ${f.file}: ${f.reason}\n`);
    }
  }
  logger.info('Tools registered', {
    declarative: load.specs.length,
    failed: load.failures.length,
    dir: load.dir,
  });

  return { server, toolCount: load.specs.length };
}

async function main(): Promise<void> {
  const { server, toolCount } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[carrefour-drive] MCP server ready — ${toolCount} API tools loaded\n`);
}

main().catch((error) => {
  logger.error('Failed to start server', { error: String(error) });
  process.stderr.write(`[carrefour-drive] fatal: ${String(error)}\n`);
  process.exit(1);
});
