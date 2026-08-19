import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from 'dotenv';
import {
  registerAuthTools,
  registerStoreTools,
  registerSearchTools,
  registerCartTools,
  registerSlotTools,
  registerListTools,
  registerHistoryTools,
} from './tools/index.js';
import { logger } from './utils/logger.js';

// Load environment variables
config();

const server = new McpServer({
  name: 'carrefour-drive',
  version: '1.0.0',
});

// Register all tools
registerAuthTools(server);
registerStoreTools(server);
registerSearchTools(server);
registerCartTools(server);
registerSlotTools(server);
registerListTools(server);
registerHistoryTools(server);

// Start the server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Carrefour Drive MCP server started');
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
