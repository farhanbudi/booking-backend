// Logger terpusat untuk seluruh aplikasi.
//
// `wrap()` dari `@bogeychan/elysia-logger` di versi 0.1.10 (lihat
// `node_modules/@bogeychan/elysia-logger/dist/index.d.ts`) punya signature:
//   wrap(logger: Logger, options?: ElysiaLoggerOptions): Elysia<...>
// dengan `ElysiaLoggerOptions` mencakup `autoLogging?: boolean | { ignore: ... }`,
// `useLevel?: pino.LevelWithSilent` (default "info"), dan `customProps?`.
// Kita oper instance `pino` kita sendiri (multistream + redact) supaya
// redaction/level/multistream tetap di bawah kendali kode kita, sementara
// auto request/error logging diurus oleh plugin.
//
// Format file log: NDJSON — satu objek JSON per baris, BUKAN satu array
// JSON yang membungkus semua entry. Ini adalah format standar pino/Bunyan
// yang stream-appendable dan mudah di-parse per baris.
import fs from "node:fs";
import path from "node:path";
import pino, { multistream } from "pino";
import pretty from "pino-pretty";
import { wrap } from "@bogeychan/elysia-logger";

const isProduction = process.env.NODE_ENV === "production";
const level =
  process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");
const streamLevel: pino.Level = (level as pino.Level) ?? "info";

// Pastiin direktori `logs/` ada sebelum kita nulis ke file tujuan.
// `recursive: true` bikin mkdir tidak error kalau direktori sudah ada.
const logsDir = path.resolve(process.cwd(), "logs");
fs.mkdirSync(logsDir, { recursive: true });

const fileStream = pino.destination(path.join(logsDir, "app.log"));

const streams: pino.StreamEntry[] = [
  // Stdout: pretty-print hanya di non-production (dev). Di production,
  // output stdout mentah JSON biar konsisten dengan file dan gampang di-ship
  // ke aggregator tanpa konversi.
  {
    level: streamLevel,
    stream: isProduction
      ? process.stdout
      : pretty({
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        }),
  },
  // File: SELALU NDJSON mentah, tanpa pretty. Ini yang di-tail oleh
  // script `logs:tail` (pipe manual ke pino-pretty) dan yang bakal di-ship
  // ke log aggregator di production.
  {
    level: streamLevel,
    stream: fileStream,
  },
];

export const logger = pino(
  {
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    // Redact path yang umum menyimpan data sensitif. Pino menerapkan path
    // ini secara global terhadap object yang di-log, jadi field body
    // request yang di-log akan otomatis di-redact tanpa developer harus
    // ingat memfilter manual.
    redact: {
      paths: [
        "password",
        "passwordHash",
        "*.password",
        "*.passwordHash",
        "req.headers.authorization",
        "token",
      ],
      censor: "[REDACTED]",
    },
  },
  multistream(streams)
);

export const elysiaLogger = wrap(logger, { autoLogging: true });