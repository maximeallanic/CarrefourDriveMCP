import winston from 'winston';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'carrefour-drive-mcp' },
  transports: [
    new winston.transports.File({
      filename: join(__dirname, '../../data/error.log'),
      level: 'error',
    }),
    new winston.transports.File({
      filename: join(__dirname, '../../data/combined.log'),
    }),
  ],
});

// In development, also log to console
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
      // Only log errors to console to avoid polluting MCP stdio
      level: 'error',
    })
  );
}
