import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getUsersRoute,
  getUserByIdRoute,
  createUserRoute,
  inviteUserRoute,
  updatePasswordRoute,
} from "./users.contract";

import { usersService } from "./users.service";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

app.openapi(getUsersRoute, async (c) => {
  const db = c.get("db");

  const users = await usersService.getAll(db);

  return c.json(users);
});

app.openapi(getUserByIdRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const user = await usersService.getById(db, id);

  if (!user) {
    return c.json({ message: "User not found" }, 404);
  }

  return c.json(user);
});

app.openapi(createUserRoute, async (c) => {
  const db = c.get("db");
  const supabase = c.get("supabase");

  const body = c.req.valid("json");

  const user = await usersService.create(db, supabase, body);

  return c.json(user, 201);
});

app.openapi(inviteUserRoute, async (c) => {
  const db = c.get("db");
  const supabase = c.get("supabase");
  const { id } = c.req.valid("param");

  try {
    const inviteResult = await usersService.invite(db, supabase, id);

    if (!inviteResult) {
      return c.json({ message: "User not found" }, 404);
    }

    return c.json(
      {
        success: true,
        message: "Invitation link generated and dispatched.",
      },
      200,
    );
  } catch (error: any) {
    return c.json(
      { message: error.message || "Invitation execution error" },
      400,
    );
  }
});

app.openapi(updatePasswordRoute, async (c) => {
  const db = c.get("db");
  const authUser = c.get("authUser");
  const supabase = c.get("supabase");
  const { password } = c.req.valid("json");

  if (!authUser) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const { error: authError } = await supabase.auth.admin.updateUserById(
    authUser.id, 
    { password: password }
  );

  if (authError) {
    return c.json({ message: authError.message }, 400);
  }

  await usersService.updateStatusByAuthId(db, authUser.id, "confirmed");

  return c.json({
    success: true,
    message: "Password updated successfully.",
  }, 200);
});


export default app;
