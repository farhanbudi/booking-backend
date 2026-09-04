// Live-tail `logs/app.log` lewat pino-pretty. Cross-platform: jalan di
// Windows, macOS, Linux tanpa dependensi `tail`/`grep`. Real-time (langsung
// append, bukan nunggu rotate).
//
// Mekanisme:
//   1. Polling ukuran file tiap 100ms — fs.watch tidak reliable untuk
//      append-only file di Windows (event sering tidak fire sampai truncate).
//   2. Saat ukuran membesar, baca byte baru dan pipe per-line ke pino-pretty.
//   3. Saat ukuran mengecil (truncate/rotate), mulai ulang dari 0.
//   4. spawn `pino-pretty` dari node_modules langsung sebagai child process
//      (no shell intermediari, no `bunx`/`npx` overhead).
//   5. CTRL+C / SIGTERM menutup child dengan bersih.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { createRequire } from "node:module";

const localRequire = createRequire(import.meta.url);

const logPath = path.resolve(process.cwd(), "logs", "app.log");
fs.mkdirSync(path.dirname(logPath), { recursive: true });

if (!fs.existsSync(logPath)) {
  console.error(`[logs:tail] menunggu ${logPath} muncul...`);
  while (!fs.existsSync(logPath)) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

console.error(`[logs:tail] live-tail ${logPath} (Ctrl+C untuk keluar)`);

// Resolve `pino-pretty` lewat `package.json#bin` agar path absolute ke
// script `bin.js` (bukan module entry), tanpa tergantung `bunx`/`npx` shell.
const pinoPrettyPkgPath = localRequire.resolve("pino-pretty/package.json");
const pinoPrettyPkg = JSON.parse(fs.readFileSync(pinoPrettyPkgPath, "utf8"));
const pinoPrettyBinRel =
  pinoPrettyPkg.bin?.["pino-pretty"] ?? pinoPrettyPkg.bin ?? "./bin.js";
const pinoPrettyPath = path.resolve(
  path.dirname(pinoPrettyPkgPath),
  pinoPrettyBinRel
);

const child = spawn(process.execPath, [pinoPrettyPath], {
  stdio: ["pipe", "inherit", "inherit"],
  shell: false,
});

child.on("error", (err) => {
  console.error(`[logs:tail] gagal spawn pino-pretty: ${err.message}`);
  process.exit(1);
});

const cleanup = () => {
  try {
    child.stdin?.end();
  } catch {}
  try {
    child.kill();
  } catch {}
};
process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(0);
});

let offset = fs.statSync(logPath).size;
let draining = false;

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
    rl.on("line", (line) => {
      if (line.length > 0) {
        child.stdin.write(line + "\n");
      }
    });
    rl.on("close", () => {
      // `stream.bytesRead` = byte yang dibaca sejak `start`, jadi ini = jumlah
      // byte baru yang sudah diproses.
      resolve(stream.bytesRead);
    });
    stream.on("error", (err) => {
      console.error(`[logs:tail] read error: ${err.message}`);
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

// Trigger pertama supaya entry yang sudah ada langsung tampil.
await tick();

// Jangan biarkan process exit sebelum di-terminate user.
process.stdin.resume();