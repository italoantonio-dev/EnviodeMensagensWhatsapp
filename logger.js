/* ============================================================
   Logger — Winston-based structured logging
   Outputs JSON to file + colored compact format to console.
   ============================================================ */

import winston from 'winston'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const LOGS_DIR = path.join(__dirname, 'logs')

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true })
}

const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').trim().toLowerCase()

// ── Console format (compact, colorized) ───────────────────
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message }) => {
    return `${timestamp} ${level}: ${message}`
  })
)

// ── File format (JSON structured) ─────────────────────────
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
)

export const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'bot-panel' },
  transports: [
    // Console — always
    new winston.transports.Console({
      format: consoleFormat
    }),

    // Combined log — all levels
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'combined.log'),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,   // 5 MB
      maxFiles: 5,
      tailable: true
    }),

    // Error log — errors only
    new winston.transports.File({
      filename: path.join(LOGS_DIR, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true
    })
  ]
})
