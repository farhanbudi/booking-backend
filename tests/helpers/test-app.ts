// Membangun instance app Elysia untuk dipakai test secara in-process via `app.handle()`.
// Tidak menyalakan `.listen()` supaya test tidak perlu port. App dibangun ulang tiap
// pemanggilan agar JWT_SECRET (dibaca saat build time) selalu sesuai state test.

import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "../../src/routes/auth.routes";
import { resourceRoutes } from "../../src/routes/resources.routes";
import { bookingRoutes } from "../../src/routes/bookings.routes";
import { AppError } from "../../src/utils/errors";

export function buildApp() {
  const app = new Elysia()
    .use(cors())

    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message };
      }

      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Input tidak valid", detail: error.message };
      }

      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Route tidak ditemukan" };
      }

      console.error(error);
      set.status = 500;
      return { error: "Terjadi kesalahan pada server" };
    })

    .get("/", () => ({ status: "ok", service: "booking-backend" }))

    .use(authRoutes)
    .use(resourceRoutes)
    .use(bookingRoutes);

  return app;
}

export type TestApp = ReturnType<typeof buildApp>;

// Helper kecil: eksekusi request JSON terhadap app dan parse respons.
export async function requestJson(
  app: TestApp,
  path: string,
  init: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) {
    headers.authorization = `Bearer ${init.token}`;
  }

  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
  );

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { status: res.status, data };
}