import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { authRoutes } from "./routes/auth.routes";
import { resourceRoutes } from "./routes/resources.routes";
import { bookingRoutes } from "./routes/bookings.routes";
import { AppError } from "./utils/errors";

const app = new Elysia()
  .use(cors())

  // Global error handler: ubah AppError (dan turunannya) jadi response JSON yang konsisten.
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
  .use(bookingRoutes)

  .listen(process.env.PORT ?? 3000);

console.log(
  `🦊 Booking backend jalan di http://${app.server?.hostname}:${app.server?.port}`
);
