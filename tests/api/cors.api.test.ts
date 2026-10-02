import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildApp } from "../helpers/test-app";

// Semua file test berbagi satu proses, jadi env yang dimodifikasi HARUS dikembalikan.
const original = process.env.CORS_ALLOWED_ORIGINS;

const ORIGIN_TERDAFTAR = "https://app.example.com";
const ORIGIN_ASING = "https://penyerang.example.com";

beforeEach(() => {
  process.env.CORS_ALLOWED_ORIGINS = `${ORIGIN_TERDAFTAR},https://admin.example.com`;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = original;
  }
});

// buildApp() membaca env saat dipanggil, jadi app harus dibangun ulang setelah
// setiap perubahan CORS_ALLOWED_ORIGINS.
async function call(
  path: string,
  init: { method?: string; origin?: string | null } = {}
) {
  const app = buildApp();
  const headers: Record<string, string> = {};
  if (init.origin) {
    headers.origin = init.origin;
  }
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
    })
  );
}

describe("Header CORS untuk request biasa", () => {
  test("origin terdaftar menerima Access-Control-Allow-Origin yang sama persis", async () => {
    const res = await call("/", { origin: ORIGIN_TERDAFTAR });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_TERDAFTAR);
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("origin kedua pada daftar juga diterima", async () => {
    const res = await call("/", { origin: "https://admin.example.com" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://admin.example.com");
  });

  test("origin tak terdaftar tidak menerima header allow", async () => {
    const res = await call("/", { origin: ORIGIN_ASING });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("origin mirip allowlist tapi berakhiran domain lain tetap ditolak", async () => {
    const res = await call("/", { origin: `${ORIGIN_TERDAFTAR}.evil.com` });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("request tanpa header Origin tetap dilayani", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(JSON.parse(await res.text()).status).toBe("ok");
  });

  test("credentials tidak pernah dikirim", async () => {
    const res = await call("/", { origin: ORIGIN_TERDAFTAR });
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("Header CORS untuk preflight", () => {
  test("preflight OPTIONS mencantumkan method dan header yang diizinkan", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/resources", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN_TERDAFTAR,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      })
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_TERDAFTAR);

    const methods = res.headers.get("access-control-allow-methods") ?? "";
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(methods).toContain(method);
    }

    const allowedHeaders = (res.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    expect(allowedHeaders).toContain("authorization");
    expect(allowedHeaders).toContain("content-type");
    expect(allowedHeaders).toContain("accept");

    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  test("preflight dari origin tak terdaftar tidak mendapat header allow", async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request("http://localhost/resources", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN_ASING,
          "access-control-request-method": "POST",
        },
      })
    );

    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Fallback localhost saat env kosong", () => {
  test("origin localhost diizinkan dan origin publik tidak", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "";
    expect((await call("/", { origin: "http://localhost:5173" })).headers.get("access-control-allow-origin"))
      .toBe("http://localhost:5173");
    expect((await call("/", { origin: ORIGIN_ASING })).headers.get("access-control-allow-origin"))
      .toBeNull();
  });
});