import { createModuleApp } from "@/core/utils/module-app";
import {
  createInspectionRoute,
  createInspectionFlagRoute,
  getInspectionByIdRoute,
  getInspectionByReservationRoute,
  pingInspectionRoute,
} from "./inspections.contract";
import { inspectionsService } from "./inspections.service";
import { inspectionErrors } from "./inspections.errors";
import { assertCanCreateFlag, assertCanCreateInspection, checkExistence } from "@/core/utils/db-validator";

const app = createModuleApp();

app.openapi(createInspectionRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw inspectionErrors.unauthenticated();
  }

  await assertCanCreateInspection(db, body.reservationId);

  const newInspection = await inspectionsService.create(db, body);

  return c.json(newInspection, 201);
});

app.openapi(createInspectionFlagRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");


  await assertCanCreateFlag(db, {
    inspectionId: id,
    shotId: body.shotId  || "",
    maxHoursWindow: 6,
  });

  const newFlag = await inspectionsService.createFlag(db, id, body);

  return c.json(newFlag, 201);
});

app.openapi(getInspectionByIdRoute, async (c) => {
  const { id } = c.req.valid("param");
  const { detailed } = c.req.valid("query");

  const inspection = await inspectionsService.getById(c.var.db, id, detailed);

  if (!inspection) {
    throw inspectionErrors.notFound({ id });
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
    throw inspectionErrors.notFound({ reservationId });
  }

  return c.json(inspection, 200);
});

app.openapi(pingInspectionRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const userAgent = c.req.header("user-agent") ?? "Unknown";
  const tracked = await inspectionsService.recordVisit(db, id, userAgent);

  if (!tracked) {
    throw inspectionErrors.notFound({ id });
  }

  return c.json({ success: true, tracked: true }, 200);
});

export default app;