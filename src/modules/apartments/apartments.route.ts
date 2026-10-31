import { createModuleApp } from "@/core/utils/module-app";
import {
  getApartmentsRoute,
  getApartmentByIdRoute,
  createApartmentRoute,
  requestUploadTokensRoute,
  confirmUploadRoute,
  getApartmentsByHostRoute,
} from "./apartments.contract";
import { apartmentsService } from "./apartments.service";
import { apartmentErrors } from "./apartments.errors";
import { checkExistence } from "@/core/utils/db-validator";
import { usersService } from "../users/users.service";

const app = createModuleApp();

app.openapi(getApartmentsRoute, async (c) => {
  const db = c.get("db");
  const apartments = await apartmentsService.getAll(db);

  return c.json(apartments, 200);
});

app.openapi(getApartmentByIdRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const apartment = await apartmentsService.getById(db, id);

  if (!apartment) {
    throw apartmentErrors.notFound({ id });
  }

  return c.json(apartment, 200);
});

app.openapi(createApartmentRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");

  const { owner, location } = body;

  await checkExistence(db, "users", owner);
  await checkExistence(db, "locations", location);

  const apartment = await apartmentsService.create(db, body);

  return c.json(apartment, 201);
});

app.openapi(requestUploadTokensRoute, async (c) => {
  const db = c.get("db");
  const s3 = c.get("s3");
  const bucketName = c.get("r2BucketName");

  const { id } = c.req.valid("param");
  const { fileTypes } = c.req.valid("json");

  await checkExistence(db, "apartments", id);

  const tokens = await apartmentsService.generateUploadTokens(
    s3,
    bucketName,
    id,
    fileTypes,
  );

  return c.json({ tokens }, 200);
});

app.openapi(confirmUploadRoute, async (c) => {
  const db = c.get("db");
  const { id: apartmentId } = c.req.valid("param");
  const body = c.req.valid("json");

  const result = await apartmentsService.syncUploadedPhotos(
    db,
    apartmentId,
    body,
  );

  return c.json(result, 200);
});

app.openapi(getApartmentsByHostRoute, async (c) => {
  const db = c.get("db");
  const authUser = c.get("authUser");

  const user = await usersService.getByAuthId(db, authUser.id);
  if (!user) {
    // Deliberate 404, not 403: the caller is authenticated but has no user row. Returning 403
    // here would confirm which accounts exist; 404 leaks nothing. See docs/errorHandlePlan.md 5.4.
    throw apartmentErrors.userNotFound({ authId: authUser.id });
  }

  const userApartments = await apartmentsService.getByOwnerId(db, user.id);

  return c.json(userApartments, 200);
});

export default app;
