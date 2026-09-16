import { Elysia, t } from "elysia";
import { authPlugin, requireAuth } from "../middleware/auth.middleware";
import { registerUser, validateLogin, getUserById } from "../modules/auth/auth.service";
import { createSession, validateSession, revokeSession } from "../modules/auth/session.service";

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
      const accessToken = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + Number(process.env.ACCESS_TOKEN_TTL_MINUTES ?? 15) * 60,
      });
      const refreshToken = await createSession({
        userId: user.id,
        userAgent: null,
        ipAddress: null,
      });
      return { accessToken, refreshToken, token: accessToken };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    }
  )

  .post(
    "/refresh",
    async ({ body, jwt }) => {
      const session = await validateSession(body.refreshToken);
      const user = await getUserById(session.userId);
      const accessToken = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + Number(process.env.ACCESS_TOKEN_TTL_MINUTES ?? 15) * 60,
      });
      return { accessToken };
    },
    {
      body: t.Object({
        refreshToken: t.String(),
      }),
    }
  )

  // protected route (need token)
  .use(requireAuth)
  .post(
    "/logout",
    async ({ body }) => {
      await revokeSession(body.refreshToken);
      return { success: true };
    },
    {
      detail: {
        security: [{ bearerAuth: [] }]
      },
      body: t.Object({
        refreshToken: t.String(),
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
