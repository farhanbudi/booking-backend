import { Elysia, t } from "elysia";
import { authPlugin } from "../middleware/auth.middleware";
import { registerUser, validateLogin, getUserById } from "../modules/auth/auth.service";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authPlugin)

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

  .get("/me", async ({ getUser }) => {
    const payload = await getUser();
    const user = await getUserById(payload.sub);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  });
