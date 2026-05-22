import { OpenAPIHono } from "@hono/zod-openapi";
import { getUsersRoute, getUserByIdRoute } from "./users.contract";
import { usersService } from "./users.service";

const app = new OpenAPIHono();

app.openapi(getUsersRoute, (c) => {
  const users = usersService.getAll();

  return c.json(users);
});

app.openapi(getUserByIdRoute, (c) => {
  const { id } = c.req.valid("param");

  const user = usersService.getById(id);

  if (!user) {
    return c.json(
      {
        message: "User not found",
      },
      404,
    );
  }

  return c.json(user);
});

export default app;
