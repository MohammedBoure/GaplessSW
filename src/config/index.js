/**
 * Gapless Configuration & Environment Settings
 * Provides centralized configuration for the server, database, security, and agy engine.
 */
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',

  // Admin credentials per specification
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',

  // Cryptographic secret for token signing
  SESSION_SECRET: process.env.SESSION_SECRET || crypto.createHash('sha256').update('gapless-secret-key-2026').digest('hex'),

  // Rate limiting & brute-force rules
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 5 * 60 * 1000, // 5 minutes in milliseconds

  // Paths
  ROOT_DIR,
  DATA_DIR: path.join(ROOT_DIR, 'data'),
  DB_PATH: path.join(ROOT_DIR, 'data', 'gapless.db'),
  UPLOADS_DIR: path.join(ROOT_DIR, 'uploads'),
  SANDBOX_DIR: path.join(ROOT_DIR, 'sandbox_env'),
  PUBLIC_DIR: path.join(ROOT_DIR, 'public'),

  // AGY CLI settings
  AGY_BIN: process.env.AGY_BIN || '/home/pluto/.local/bin/agy',
  AGY_TIMEOUT_MS: parseInt(process.env.AGY_TIMEOUT_MS || '90000', 10),
};
