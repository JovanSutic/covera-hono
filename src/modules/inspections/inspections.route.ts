import { OpenAPIHono } from "@hono/zod-openapi";
import {
  createInspectionRoute,
  getInspectionByIdRoute,
  getInspectionByReservationRoute,
  pingInspectionRoute,
} from "./inspections.contract";
import { inspectionsService } from "./inspections.service";
import {
  NotFoundException,
  UnauthorizedException,
} from "@/core/errors/error.exceptions";
import { assertCanCreateInspection, checkExistence } from "@/core/utils/db-validator";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

app.openapi(createInspectionRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw new UnauthorizedException("Inspection");
  }

  await assertCanCreateInspection(db, body.reservationId);

  const newInspection = await inspectionsService.create(db, body);

  return c.json(newInspection, 201);
});

app.openapi(getInspectionByIdRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { detailed } = c.req.valid("query");

  const inspection = await inspectionsService.getById(c.var.db, id, detailed);

  if (!inspection) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Inspection not found",
        },
      },
      404,
    );
  }

  return c.json(inspection, 200);
});

app.openapi(getInspectionByReservationRoute, async (c) => {
  const db = c.get("db");
  const { reservationId } = c.req.valid("param");

  await checkExistence(db, "reservations", reservationId);

  const inspection = await inspectionsService.getByReservationId(
    db,
    reservationId,
  );

  if (!inspection) {
    throw new NotFoundException("Inspection");
  }

  return c.json(inspection, 200);
});

app.openapi(pingInspectionRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const userAgent = c.req.header("user-agent") ?? "Unknown";
  const tracked = await inspectionsService.recordVisit(db, id, userAgent);

  if (!tracked) {
    throw new NotFoundException("Inspection");
  }

  return c.json({ success: true, tracked: true }, 200);
});

export default app;
