import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import usersRoutes from "./modules/users/users.route";
import apartmentsRoutes from "./modules/apartments/apartments.route";
import reservationsRoutes from "./modules/reservations/reservations.route";
import locationsRoutes from "./modules/locations/locations.route";
import { dbMiddleware } from "./middleware/db";
import { App } from "./types";
import { supabaseMiddleware } from "./middleware/supabase";
import { s3Middleware } from "./middleware/s3";
import { CustomException } from "./core/errors/error.exceptions";
import { cors } from "hono/cors";

const app = new OpenAPIHono<App>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const formattedDetails = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));

      return c.json(
        {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "The request parameters failed validation tests.",
            details: formattedDetails,
          },
        },
        400,
      );
    }
  },
});

app.onError((err, c) => {
  if (err instanceof CustomException) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
        },
      },
      err.status,
    );
  }

  console.error(`[Unhandled Error]: ${err.message}`, err.stack);
  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong on our end.",
      },
    },
    500,
  );
});

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "https://covera.josutic-sutic.workers.dev"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

if (process.env.NODE_ENV !== "test") {
  app.use("*", dbMiddleware);
  app.use("*", supabaseMiddleware);
  app.use("*", s3Middleware);
}

app.route("/users", usersRoutes);
app.route("/apartments", apartmentsRoutes);
app.route("/reservations", reservationsRoutes);
app.route("/locations", locationsRoutes);

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Hono API",
    version: "1.0.0",
  },
});

app.get("/docs", swaggerUI({ url: "/openapi.json" }));

export default app;
