import winston from 'winston';
import { mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const LOG_DIR = process.env.CARREFOUR_LOG_DIR
  ? resolve(process.env.CARREFOUR_LOG_DIR)
  : join(__dirname, '..', '..', 'data');

const transports: winston.transport[] = [];

try {
  mkdirSync(LOG_DIR, { recursive: true });
  transports.push(
    new winston.transports.File({ filename: join(LOG_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: join(LOG_DIR, 'combined.log') })
  );
} catch {
  // Read-only install: fall back to stderr only.
}

// NEVER log to stdout: stdout is the MCP stdio transport.
transports.push(
  new winston.transports.Stream({
    stream: process.stderr,
    level: process.env.LOG_LEVEL || 'error',
    format: winston.format.simple(),
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'carrefour-drive-mcp' },
  transports,
});
