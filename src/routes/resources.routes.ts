import { Elysia, t } from "elysia";
import { requireAuth, requireAdmin } from "../middleware/auth.middleware";
import {
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
} from "../modules/resources/resources.service";

export const resourceRoutes = new Elysia({ prefix: "/resources" })
  .use(requireAuth)
  .guard({ detail: { security: [{ bearerAuth: [] }] } }, (app) =>
    app
      .get(
        "/",
        async ({ query }) => {
          const minCapacity = query.minCapacity ? Number(query.minCapacity) : undefined;
          return listResources({ minCapacity });
        },
        {
          query: t.Object({
            minCapacity: t.Optional(t.String()),
          }),
        }
      )

      .get("/:id", async ({ params }) => getResourceById(params.id))

      .post(
        "/",
        async ({ body, currentUser, set }) => {
          requireAdmin(currentUser);
          const resource = await createResource(body);
          set.status = 201;
          return resource;
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1 }),
            capacity: t.Integer({ minimum: 1 }),
            location: t.Optional(t.String()),
            pricePerHour: t.Optional(t.Integer({ minimum: 0 })),
          }),
        }
      )

      .patch(
        "/:id",
        async ({ params, body, currentUser }) => {
          requireAdmin(currentUser);
          return updateResource(params.id, body);
        },
        {
          body: t.Partial(
            t.Object({
              name: t.String(),
              capacity: t.Integer({ minimum: 1 }),
              location: t.String(),
              isActive: t.Boolean(),
              pricePerHour: t.Integer({ minimum: 0 }),
            })
          ),
        }
      )

      .delete("/:id", async ({ params, currentUser }) => {
        requireAdmin(currentUser);
        return deleteResource(params.id);
      })
  );
