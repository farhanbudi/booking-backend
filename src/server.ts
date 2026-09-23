import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
// @ts-ignore - types may not include all runtime options
import { authRoutes } from "./routes/auth.routes";
import { resourceRoutes } from "./routes/resources.routes";
import { bookingRoutes } from "./routes/bookings.routes";
import { paymentRoutes } from "./routes/payments.routes";
import { AppError } from "./utils/errors";
import { elysiaLogger } from "./utils/logger";

export function startServer() {
  const app = new Elysia()
    .use(elysiaLogger)
    .use(cors())
    .use(
      openapi({
        documentation: {
          components: {
            securitySchemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
              },
            },
          },
        },
        swagger: {
          persistAuthorization: true,
        },
      }),
    )
    .get("/", () => ({ status: "ok", service: "booking-backend" }))
    .get("/health", () => new Response("ok"))
    .use(authRoutes)
    .use(resourceRoutes)
    .use(bookingRoutes)
    .use(paymentRoutes)

    .onError(({ code, error, set, log }) => {
      let resolvedStatus = 0;
      if (error instanceof AppError) {
        resolvedStatus = error.statusCode;
      } else if (code === "VALIDATION") {
        resolvedStatus = 400;
      } else if (code === "NOT_FOUND") {
        resolvedStatus = 404;
      } else {
        resolvedStatus = 500;
      }
      const isServerError = resolvedStatus >= 500;
      (log as typeof log | undefined)?.[isServerError ? "error" : "warn"](
        { err: error, statusCode: resolvedStatus },
        "request error",
      );

      if (error instanceof AppError) {
        console.error("[error] AppError:", error.statusCode, error.message);
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

    .listen(process.env.PORT ?? 3000);

  console.log(
    `🦊 Booking backend jalan di http://${app.server?.hostname}:${app.server?.port}`,
  );
  return app;
}

