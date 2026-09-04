// Live-tail `logs/app.log` dengan output ringkas untuk manusia.
// Cross-platform (Windows/macOS/Linux) tanpa dependensi `tail`/`grep`.
//
// Berbeda dari `scripts/logs-tail.mjs` (pino-pretty verbose):
//   1. Tidak spawn child process — baca & format langsung di proses ini
//      sehingga startup instan dan tidak ada risiko pipa putus.
//   2. Filter: hanya tampilkan event yang relevan untuk monitoring manual.
//   3. Format kompak satu baris dengan warna ANSI minimal.
//
// Mekanisme:
//   - Polling ukuran file tiap 100ms (fs.watch tidak reliable untuk
//     append-only di Windows).
//   - Saat ukuran membesar, baca byte baru via readline per baris.
//   - Saat ukuran mengecil (truncate/rotate), mulai ulang dari 0.
//   - SIGINT/SIGTERM keluar dengan bersih.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// ---------- Konfigurasi ----------

const logPath = path.resolve(process.cwd(), "logs", "app.log");
fs.mkdirSync(path.dirname(logPath), { recursive: true });

// Regex pesan INFO yang relevan untuk manusia. Case-insensitive.
// Request error 4xx/5xx yang di-log Elysia (level=warn) selalu lolos
// otomatis, jadi tidak perlu disebut di sini.
const INTERESTING_INFO_MSG =
  /login|auth|register|booking|payment|pembayaran|slot|tumpang tindih|user dibuat|request error/i;

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

const LEVEL_COLOR = {
  10: GRAY, // trace
  20: GRAY, // debug
  30: CYAN, // info
  40: YELLOW, // warn
  50: RED, // error
  60: RED, // fatal
};
const LEVEL_NAME = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

// ---------- Util ----------

function shouldShow(entry) {
  if (typeof entry !== "object" || entry === null) return false;
  const level = typeof entry.level === "number" ? entry.level : 30;
  if (level >= 50) return true; // error & fatal — selalu tampil
  if (level >= 40) return true; // warn — selalu tampil
  if (level >= 30) {
    // info — hanya jika msg cocok kata kunci bisnis
    const msg = typeof entry.msg === "string" ? entry.msg : "";
    return INTERESTING_INFO_MSG.test(msg);
  }
  return false; // debug/trace
}

function shortValue(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    if (v.length > 120) return JSON.stringify(v.slice(0, 117) + "...");
    if (v.includes(" ") || v.includes('"') || v.includes("=")) {
      return JSON.stringify(v);
    }
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  // object/array — stringify dan truncate
  try {
    const s = JSON.stringify(v);
    if (s.length > 120) return s.slice(0, 117) + "...";
    return s;
  } catch {
    return "[unserializable]";
  }
}

const SKIP_KEYS = new Set(["level", "time", "msg", "pid", "hostname", "service"]);

function formatEntry(entry) {
  const time =
    typeof entry.time === "string"
      ? entry.time
      : new Date().toISOString();
  const level = typeof entry.level === "number" ? entry.level : 30;
  const lvlName = LEVEL_NAME[level] ?? "LOG";
  const color = LEVEL_COLOR[level] ?? "";
  const levelTag = level >= 50 ? `${BOLD}${color}${lvlName}${RESET}` : `${color}${lvlName}${RESET}`;
  const msg = typeof entry.msg === "string" ? entry.msg : "(no msg)";

  const parts = [];
  for (const [k, v] of Object.entries(entry)) {
    if (SKIP_KEYS.has(k)) continue;
    parts.push(`${k}=${shortValue(v)}`);
  }

  const timeStr = `${DIM}${time}${RESET}`;
  const tail = parts.length > 0 ? `  ${parts.join(" ")}` : "";
  return `${timeStr}  ${levelTag}  ${msg}${tail}`;
}

// ---------- Tunggu file jika belum ada ----------

if (!fs.existsSync(logPath)) {
  console.error(
    `${DIM}[logs:tail:simple]${RESET} menunggu ${logPath} muncul...`,
  );
  while (!fs.existsSync(logPath)) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

console.error(
  `${DIM}[logs:tail:simple]${RESET} live-tail ${logPath} (Ctrl+C untuk keluar)`,
);

// ---------- Loop tail ----------

let offset = fs.statSync(logPath).size;
let draining = false;

function processLine(line) {
  if (line.length === 0) return;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    // Baris bukan JSON (mis. log manual / bukan pino) — tampilkan apa adanya
    // supaya tidak diam-diam hilang. Prefix [raw] agar jelas.
    console.log(`[raw] ${line}`);
    return;
  }
  if (!shouldShow(entry)) return;
  console.log(formatEntry(entry));
}

async function drainFrom(currentOffset) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(logPath, {
      start: currentOffset,
      encoding: "utf8",
    });
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
    rl.on("line", processLine);
    rl.on("close", () => {
      // stream.bytesRead = byte yang dibaca sejak `start` = jumlah byte baru
      // yang sudah diproses.
      resolve(stream.bytesRead);
    });
    stream.on("error", (err) => {
      console.error(`[logs:tail:simple] read error: ${err.message}`);
      resolve(0);
    });
  });
}

async function tick() {
  if (draining) return;
  draining = true;
  try {
    const size = fs.statSync(logPath).size;
    if (size < offset) {
      // Truncate / rotate — mulai ulang dari 0.
      offset = 0;
    }
    if (size > offset) {
      const advanced = await drainFrom(offset);
      offset += advanced;
    }
  } catch {
    // File mungkin di-rotate/dihapus sebentar — skip tick.
  } finally {
    draining = false;
  }
}

setInterval(tick, 100);

// Tampilkan entry yang sudah ada langsung, agar user tidak perlu trigger
// request baru dulu.
await tick();

// Jangan biarkan process exit sebelum di-terminate user.
process.stdin.resume();
