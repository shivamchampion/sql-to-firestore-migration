/**
 * Simple logger utility for the migration process (without chalk dependency)
 */
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log file path
const logFilePath = path.join(logsDir, 'migration.log');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

/**
 * Get formatted timestamp
 * @returns {string} - Formatted timestamp
 */
function getTimestamp() {
  return new Date().toISOString();
}

/**
 * Write log to file
 * @param {string} level - Log level
 * @param {string} message - Log message
 */
function writeLog(level, message) {
  const logEntry = `[${getTimestamp()}] [${level.toUpperCase()}] ${message}\n`;
  fs.appendFileSync(logFilePath, logEntry);
}

/**
 * Log info message
 * @param {string} message - Log message
 */
function info(message) {
  console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
  writeLog('info', message);
}

/**
 * Log warning message
 * @param {string} message - Log message
 */
function warn(message) {
  console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
  writeLog('warn', message);
}

/**
 * Log error message
 * @param {string} message - Log message
 */
function error(message) {
  console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
  writeLog('error', message);
}

/**
 * Log debug message
 * @param {string} message - Log message
 */
function debug(message) {
  if (process.env.DEBUG) {
    console.log(`${colors.gray}[DEBUG]${colors.reset} ${message}`);
    writeLog('debug', message);
  }
}

/**
 * Log success message
 * @param {string} message - Log message
 */
function success(message) {
  console.log(`${colors.green}[SUCCESS]${colors.reset} ${message}`);
  writeLog('success', message);
}

module.exports = {
  info,
  warn,
  error,
  debug,
  success,
  colors
};