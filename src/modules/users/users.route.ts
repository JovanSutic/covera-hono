import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getUsersRoute,
  getUserByIdRoute,
  createUserRoute,
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
  const body = c.req.valid("json");

  const user = await usersService.create(db, body);

  return c.json(user, 201);
});

export default app;