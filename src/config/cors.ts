// Konfigurasi CORS untuk API. Allowlist origin dibaca dari env
// `CORS_ALLOWED_ORIGINS` (daftar origin dipisah koma) setiap kali app dibangun,
// bukan saat modul ini diimpor, supaya test bisa mengubah env sebelum
// memanggil buildApp(). Auth memakai Bearer token di header dan refresh token
// di body request, bukan cookie, jadi credentials tidak pernah diaktifkan.

import type { CORSConfig } from "@elysiajs/cors";

// Dipakai saat env kosong supaya development lokal tetap jalan tanpa setup.
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:4173",
];

export const CORS_ALLOWED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

export const CORS_ALLOWED_HEADERS = [
  "Accept",
  "Authorization",
  "Content-Type",
] as const;

// Memecah nilai env menjadi daftar origin: potong per koma, buang spasi di
// sekitar tiap entri, dan abaikan entri yang kosong.
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// Daftar origin aktif: hasil parsing env, atau daftar localhost dev bila env
// kosong. Sengaja tanpa cabang NODE_ENV supaya dev dan production memakai jalur
// kode yang sama persis.
export function getAllowedOrigins(raw: string | undefined = process.env.CORS_ALLOWED_ORIGINS): string[] {
  const parsed = parseAllowedOrigins(raw);
  return parsed.length > 0 ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

// Pencocokan berupa perbandingan string persis, bukan pola/suffix, supaya
// `https://app.example.com.evil.com` tidak ikut lolos untuk origin
// `https://app.example.com`.
export function isOriginAllowed(
  origin: string | null,
  allowedOrigins: readonly string[]
): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

// Opsi untuk plugin cors(). `allowedOrigins` ikut dikembalikan supaya bisa
// dicetak di log startup tanpa memanggil parsing dua kali.
export function buildCorsConfig(
  raw: string | undefined = process.env.CORS_ALLOWED_ORIGINS
): { allowedOrigins: string[]; config: CORSConfig } {
  const allowedOrigins = getAllowedOrigins(raw);
  return {
    allowedOrigins,
    config: {
      origin: (request: Request) =>
        isOriginAllowed(request.headers.get("origin"), allowedOrigins),
      methods: [...CORS_ALLOWED_METHODS],
      allowedHeaders: [...CORS_ALLOWED_HEADERS],
      credentials: false,
    },
  };
}

// Ringkasan allowlist aktif untuk log startup, supaya salah konfigurasi
// (mis. typo di env) kelihatan saat deploy, bukan saat dilaporkan user.
export function describeCorsAllowedOrigins(raw: string | undefined = process.env.CORS_ALLOWED_ORIGINS): string {
  const origins = getAllowedOrigins(raw);
  const sumber = parseAllowedOrigins(raw).length > 0
    ? "CORS_ALLOWED_ORIGINS"
    : "fallback localhost (CORS_ALLOWED_ORIGINS kosong)";
  return `${origins.join(", ")} [sumber: ${sumber}]`;
}