import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import usersRoutes from "./modules/users/users.route";
import apartmentsRoutes from "./modules/apartments/apartments.route";
import reservationsRoutes from "./modules/reservations/reservations.route";
import locationsRoutes from "./modules/locations/locations.route";

const app = new OpenAPIHono();

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
