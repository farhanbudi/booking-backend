import { Elysia, t } from "elysia";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";
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
  .use(requireAuth)
  .onBeforeHandle(rateLimitHook())
  .guard({ detail: { security: [{ bearerAuth: [] }] } }, (app) =>
    app
      .get(
        "/availability",
        async ({ query }) => {
          return getAvailability(query.resourceId, query.date);
        },
        {
          query: t.Object({
            resourceId: t.String(),
            date: t.String({ format: "date" }),
          }),
        }
      )

      .post(
        "/",
        async ({ body, currentUser, set }) => {
          const booking = await createBooking({
            userId: currentUser.sub,
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

      .get("/", async ({ currentUser }) => {
        return listUserBookings(currentUser.sub);
      })

      .get("/admin/all", async ({ currentUser }) => {
        requireAdmin(currentUser);
        return listAllBookings();
      })

      .patch(
        "/:id/cancel",
        async ({ params, currentUser }) => {
          return cancelBooking(params.id, currentUser.sub, currentUser.role);
        },
        { params: t.Object({ id: t.String({ format: "uuid" }) }) }
      )

      .get(
        "/:id/checkout-url",
        async ({ params, currentUser }) => {
          return getFreshCheckoutUrl(params.id, currentUser.sub);
        },
        { params: t.Object({ id: t.String({ format: "uuid" }) }) }
      )
  );