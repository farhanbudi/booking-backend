import { Elysia, t } from "elysia";
import { authPlugin, requireAdmin } from "../middleware/auth.middleware";
import { rateLimitHook } from "../middleware/rate-limit.middleware";
import {
  getAvailability,
  createBooking,
  listUserBookings,
  listAllBookings,
  cancelBooking,
} from "../modules/bookings/bookings.service";
import { getFreshCheckoutUrl } from "../modules/payments/payments.service";

export const bookingRoutes = new Elysia({ prefix: "/bookings" })
  .use(authPlugin)
  .onBeforeHandle(rateLimitHook())

  .get(
    "/availability",
    async ({ query }) => {
      return getAvailability(query.resourceId, query.date);
    },
    {
      query: t.Object({
        resourceId: t.String(),
        date: t.String({ format: "date" }), // format: YYYY-MM-DD
      }),
    }
  )

  .post(
    "/",
    async ({ body, getUser, set }) => {
      const user = await getUser();
      const booking = await createBooking({
        userId: user.sub,
        resourceId: body.resourceId,
        startTime: new Date(body.startTime),
        endTime: new Date(body.endTime),
      });
      set.status = 201;
      return booking;
    },
    {
      body: t.Object({
        resourceId: t.String(),
        startTime: t.String({ format: "date-time" }),
        endTime: t.String({ format: "date-time" }),
      }),
    }
  )

  .get("/", async ({ getUser }) => {
    const user = await getUser();
    return listUserBookings(user.sub);
  })

  .get("/admin/all", async ({ getUser }) => {
    const user = await getUser();
    requireAdmin(user);
    return listAllBookings();
  })

  .patch("/:id/cancel", async ({ params, getUser }) => {
    const user = await getUser();
    return cancelBooking(params.id, user.sub, user.role);
  })

  // Retry pembayaran: pemilik booking pending minta URL checkout segar.
  .get(
    "/:id/checkout-url",
    async ({ params, getUser }) => {
      const user = await getUser();
      return getFreshCheckoutUrl(params.id, user.sub);
    },
    {
      params: t.Object({ id: t.String({ format: "uuid" }) }),
    }
  );
