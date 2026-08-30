import { Elysia, t } from "elysia";
import { authPlugin, requireAuth } from "../middleware/auth.middleware";
import { registerUser, validateLogin, getUserById } from "../modules/auth/auth.service";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authPlugin)
  // public route (dont need token)
  .post(
    "/register",
    async ({ body, set }) => {
      const user = await registerUser(body);
      set.status = 201;
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
      }),
    }
  )

  .post(
    "/login",
    async ({ body, jwt }) => {
      const user = await validateLogin(body);
      const token = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      return { token };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    }
  )

  // protected route (need token)
  .use(requireAuth)
  .get("/me", async ({ currentUser, set }) => {
    const user = await getUserById(currentUser.sub);
    if (!user) {
      set.status = 404;
      return { message: "User not found" };
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  },
  {
    detail: {
      security: [{ bearerAuth: [] }]
    }
  }
);
