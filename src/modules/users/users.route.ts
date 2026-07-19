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
import {
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from "@/core/errors/error.exceptions";

const app = new OpenAPIHono<App>();

app.openapi(getUsersRoute, async (c) => {
  const db = c.get("db");

  const filters = c.req.valid("query");
  const matchedUsers = await usersService.getAll(db, filters);

  return c.json(matchedUsers, 200);
});

app.openapi(getUserByIdRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const user = await usersService.getById(db, id);

  if (!user) {
    throw new NotFoundException("User");
  }

  return c.json(user, 200);
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
      throw new NotFoundException("User");
    }

    return c.json(
      {
        success: true,
        message: "Invitation link generated and dispatched successfully",
      },
      200,
    );
  } catch (error: any) {
    if (error instanceof NotFoundException) throw error;

    throw new BadRequestException(
      error.message || "Invitation execution error",
      "INVITATION_ERROR",
    );
  }
});

app.openapi(updatePasswordRoute, async (c) => {
  const db = c.get("db");
  const authUser = c.get("authUser");
  const supabase = c.get("supabase");
  const { password } = c.req.valid("json");

  if (!authUser) {
    throw new UnauthorizedException();
  }

  const { error: authError } = await supabase.auth.admin.updateUserById(
    authUser.id,
    { password: password },
  );

  if (authError) {
    throw new BadRequestException(authError.message, "AUTH_PROVIDER_ERROR");
  }

  await usersService.updateStatusByAuthId(db, authUser.id, "confirmed");

  return c.json(
    {
      success: true,
      message: "Password updated successfully.",
    },
    200,
  );
});

export default app;
