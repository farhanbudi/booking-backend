import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  DEFAULT_ALLOWED_ORIGINS,
  buildCorsConfig,
  describeCorsAllowedOrigins,
  getAllowedOrigins,
  isOriginAllowed,
  parseAllowedOrigins,
} from "../../src/config/cors";

// Semua file test berbagi satu proses, jadi env yang dimodifikasi HARUS dikembalikan.
const original = process.env.CORS_ALLOWED_ORIGINS;

beforeEach(() => {
  delete process.env.CORS_ALLOWED_ORIGINS;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = original;
  }
});

// Callback `origin` pada plugin cors() menerima Request dan hanya menerima
// origin bila mengembalikan `true`; nilai lain berarti origin ditolak dan
// header Access-Control-Allow-Origin tidak ditulis sama sekali.
function originMatcher(raw: string | undefined) {
  const { config } = buildCorsConfig(raw);
  const origin = config.origin;
  if (typeof origin !== "function") {
    throw new Error("origin harus berupa callback");
  }
  return (value: string | null) => {
    const headers: Record<string, string> = {};
    if (value !== null) headers.origin = value;
    return origin(new Request("http://localhost/health", { headers }));
  };
}

describe("Parsing CORS_ALLOWED_ORIGINS", () => {
  test("env kosong dan undefined menghasilkan daftar kosong", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  test(" memecah daftar dipisah koma", () => {
    expect(parseAllowedOrigins("https://app.example.com,https://admin.example.com")).toEqual([
      "https://app.example.com",
      "https://admin.example.com",
    ]);
  });

  test(" membuang spasi di sekitar entri dan entri kosong", () => {
    expect(parseAllowedOrigins("  https://a.com , ,https://b.com  ")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  test(" satu origin tanpa koma tetap valid", () => {
    expect(parseAllowedOrigins("https://app.example.com")).toEqual([
      "https://app.example.com",
    ]);
  });
});

describe("Fallback origin development", () => {
  test(" env kosong memakai daftar localhost bawaan", () => {
    expect(getAllowedOrigins("")).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    expect(getAllowedOrigins(undefined)).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
    expect(DEFAULT_ALLOWED_ORIGINS).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:4173",
    ]);
  });

  test(" env yang hanya berisi spasi dianggap kosong", () => {
    expect(getAllowedOrigins(" , ")).toEqual([...DEFAULT_ALLOWED_ORIGINS]);
  });

  test(" env terisi tidak ditimpa fallback", () => {
    expect(getAllowedOrigins("https://app.example.com")).toEqual([
      "https://app.example.com",
    ]);
  });

  test(" membaca process.env saat env tidak diberikan argumen", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://dari-env.example.com";
    expect(getAllowedOrigins()).toEqual(["https://dari-env.example.com"]);
  });
});

describe("Opsi plugin cors", () => {
  test("method dan header mengikuti daftar eksplisit", () => {
    const { config } = buildCorsConfig("https://app.example.com");
    expect(config.methods).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
    expect(config.allowedHeaders).toEqual(["Accept", "Authorization", "Content-Type"]);
    expect(CORS_ALLOWED_METHODS).toContain("OPTIONS");
    expect(CORS_ALLOWED_HEADERS).toContain("Authorization");
  });

  test("credentials tidak diaktifkan", () => {
    expect(buildCorsConfig("https://app.example.com").config.credentials).toBe(false);
  });

  test("origin terdaftar diterima", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com";
    const matcher = originMatcher(undefined);
    expect(matcher("https://app.example.com")).toBe(true);
    expect(matcher("https://admin.example.com")).toBe(true);
  });

  test(" origin tak terdaftar ditolak", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
    const matcher = originMatcher(undefined);
    expect(matcher("https://penyerang.example.com")).toBe(false);
  });

  test(" request tanpa header Origin ditolak tanpa error", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com";
    expect(originMatcher(undefined)(null)).toBe(false);
  });

  test(" env berbeda menghasilkan allowlist berbeda", () => {
    expect(originMatcher("https://satu.example.com")("https://satu.example.com")).toBe(true);
    expect(originMatcher("https://dua.example.com")("https://satu.example.com")).toBe(false);
  });

  test(" env kosong memakai fallback localhost", () => {
    process.env.CORS_ALLOWED_ORIGINS = "";
    const matcher = originMatcher(undefined);
    expect(matcher("http://localhost:5173")).toBe(true);
    expect(matcher("https://penyerang.example.com")).toBe(false);
  });
});

describe("Pencocokan origin", () => {
  test(" harus persis, tanpa suffix yang menyerupai", () => {
    const allowed = ["https://app.example.com"];
    expect(isOriginAllowed("https://app.example.com", allowed)).toBe(true);
    expect(isOriginAllowed("https://app.example.com.evil.com", allowed)).toBe(false);
    expect(isOriginAllowed("http://app.example.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://app.example.com:8443", allowed)).toBe(false);
  });

  test(" origin null tidak pernah diizinkan", () => {
    expect(isOriginAllowed(null, ["https://app.example.com"])).toBe(false);
  });
});

describe("Deskripsi allowlist untuk log startup", () => {
  test(" menyebut daftar env yang aktif", () => {
    const description = describeCorsAllowedOrigins("https://app.example.com,https://admin.example.com");
    expect(description).toContain("https://app.example.com");
    expect(description).toContain("https://admin.example.com");
    expect(description).toContain("CORS_ALLOWED_ORIGINS");
  });

  test(" menandai saat memakai fallback localhost", () => {
    const description = describeCorsAllowedOrigins("");
    expect(description).toContain("fallback localhost");
    expect(description).toContain("http://localhost:5173");
  });
});