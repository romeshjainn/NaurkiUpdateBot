const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format: [YYYY-MM-DD HH:MM:SS] [LEVEL] [COMPONENT] Message
const customFormat = winston.format.printf(({ level, message, timestamp, component }) => {
  const comp = component ? `[${component}]` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${comp} ${message}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL?.toLowerCase() || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        customFormat
      ),
    }),
    // File output (append mode)
    new winston.transports.File({
      filename: path.join(logsDir, 'naukri_bot.log'),
      maxsize: 5 * 1024 * 1024, // 5MB per file
      maxFiles: 4, // Keep 4 weeks of logs
      tailable: true,
    }),
    // Separate error log
    new winston.transports.File({
      filename: path.join(logsDir, 'naukri_bot_error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 4,
    }),
  ],
});

/**
 * Create a child logger with a component name
 * @param {string} component - Name of the component (e.g., 'Auth', 'HeadlineUpdater')
 * @returns {object} Logger with component context
 */
function createComponentLogger(component) {
  return {
    debug: (msg, meta) => logger.debug(msg, { component, ...meta }),
    info: (msg, meta) => logger.info(msg, { component, ...meta }),
    warn: (msg, meta) => logger.warn(msg, { component, ...meta }),
    error: (msg, meta) => logger.error(msg, { component, ...meta }),
    fatal: (msg, meta) => logger.error(`[FATAL] ${msg}`, { component, ...meta }),
    success: (msg, meta) => logger.info(`✅ ${msg}`, { component, ...meta }),
  };
}

module.exports = { logger, createComponentLogger };
