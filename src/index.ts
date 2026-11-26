import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import usersRoutes from "./modules/users/users.route";
import apartmentsRoutes from "./modules/apartments/apartments.route";
import reservationsRoutes from "./modules/reservations/reservations.route";
import locationsRoutes from "./modules/locations/locations.route";
import assetsRoutes from "./modules/assets/assets.route";
import shotsRoutes from "./modules/apartment_shots/apartment_shots.route";
import inspectionsRoutes from "./modules/inspections/inspections.route";
import incidentsRoutes from "./modules/incidents/incidents.route";
import incidentsFieldRoutes from "./modules/incidents/incidents.field.route";
import specialAccessRoutes from "./modules/special_access/special_access.route";
import { dbMiddleware } from "./middleware/db";
import { App } from "./types";
import { supabaseMiddleware } from "./middleware/supabase";
import { s3Middleware } from "./middleware/s3";
import { renderError, toErrorResponse, validationHook } from "./core/errors/error.handler";
import { cors } from "hono/cors";

const app = new OpenAPIHono<App>({
  defaultHook: validationHook,
});

app.onError((err, c) => {
  const { status, body } = toErrorResponse(err);
  if (status >= 500) console.error("[Unhandled Error]", err);
  return c.json(body, status);
});

app.notFound((c) => {
  const body = renderError({
    code: "ROUTE_NOT_FOUND",
    message: `Route ${c.req.method} ${c.req.path} does not exist.`,
    status: 404,
  });
  return c.json(body, 404);
});

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "https://covera.josutic-sutic.workers.dev"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
app.route("/assets", assetsRoutes);
app.route("/apartment-shots", shotsRoutes);
app.route("/inspections", inspectionsRoutes);
app.route("/incidents", incidentsRoutes);
app.route("/field/ingest", incidentsFieldRoutes);
app.route("/special-access", specialAccessRoutes);

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Hono API",
    version: "1.0.0",
  },
});

/**
 * The access-link credential, declared for code generation only. The guard is
 * either-or — a bearer session OR `?accessId=` — and OpenAPI 3.0 cannot express
 * that, so no route carries a `security` array (which would mean "required") and
 * this scheme is a declaration, not a requirement (D7).
 *
 * Registering after `app.doc` is fine: the document is generated per request, not
 * captured at this call.
 */
app.openAPIRegistry.registerComponent("securitySchemes", "specialAccess", {
  type: "apiKey",
  in: "query",
  name: "accessId",
  description:
    "Alternative to a bearer session on the routes that accept an access link. " +
    "Supply it as a query parameter; the session is then ignored entirely.",
});

app.get("/docs", swaggerUI({ url: "/openapi.json" }));

export default app;
