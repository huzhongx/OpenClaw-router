import { createApp } from './app';
import { config } from './config';
import { getDb } from './db/connection';
import pino from 'pino';

const logger = pino({ level: config.logLevel });

// Prevent crashes from unhandled promise rejections
// Without this, Node.js v22+ will terminate the process on unhandled rejection
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

async function main() {
  // Initialize database
  getDb();

  const app = createApp();

  app.listen(config.port, config.host, () => {
    logger.info(`OpenClaw Router listening on http://${config.host}:${config.port}`);
    logger.info(`Admin panel: http://${config.host}:${config.port}/admin`);
    logger.info(`API base: http://${config.host}:${config.port}/v1`);
  });
}

main().catch((err) => {
  logger.error(err, 'Failed to start');
  process.exit(1);
});
