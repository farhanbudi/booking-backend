import { Elysia, t } from "elysia";
import { authPlugin, requireAdmin } from "../middleware/auth.middleware";
import {
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
} from "../modules/resources/resources.service";

export const resourceRoutes = new Elysia({ prefix: "/resources" })
  .use(authPlugin)

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
    async ({ body, getUser, set }) => {
      const user = await getUser();
      requireAdmin(user);
      const resource = await createResource(body);
      set.status = 201;
      return resource;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        capacity: t.Integer({ minimum: 1 }),
        location: t.Optional(t.String()),
      }),
    }
  )

  .patch(
    "/:id",
    async ({ params, body, getUser }) => {
      const user = await getUser();
      requireAdmin(user);
      return updateResource(params.id, body);
    },
    {
      body: t.Partial(
        t.Object({
          name: t.String(),
          capacity: t.Integer({ minimum: 1 }),
          location: t.String(),
          isActive: t.Boolean(),
        })
      ),
    }
  )

  .delete("/:id", async ({ params, getUser }) => {
    const user = await getUser();
    requireAdmin(user);
    return deleteResource(params.id);
  });
