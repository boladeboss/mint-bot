/**
 * Structured logging with pino.
 * Creates child loggers per component for clean context in log lines.
 */

import pino from 'pino';

const isDev = process.env['NODE_ENV'] !== 'production';
const level = process.env['LOG_LEVEL'] ?? 'info';

/** Root logger instance */
const rootLogger = pino({
  level,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

/**
 * Create a child logger for a specific component.
 * @param component - Component name (e.g. 'adapter:eth', 'strategy', 'telegram')
 */
export function createLogger(component: string): pino.Logger {
  return rootLogger.child({ component });
}

export default rootLogger;
