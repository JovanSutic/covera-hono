import { createModuleApp } from "@/core/utils/module-app";
import {
  getAssetsByApartmentRoute,
  createAssetRoute,
  deleteAssetRoute,
} from "./assets.contract";
import { assetsService } from "./assets.service";
import { assetErrors } from "./assets.errors";
import {
  assertCanModifyAsset,
  checkExistence,
} from "@/core/utils/db-validator";

const app = createModuleApp();

app.openapi(getAssetsByApartmentRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");

  await checkExistence(db, "apartments", apartmentId);

  const assetsList = await assetsService.getByApartmentId(db, apartmentId);

  return c.json(assetsList, 200);
});

app.openapi(createAssetRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");

  await checkExistence(db, "apartments", body.apartmentId);
  await checkExistence(db, "assetTypes", body.assetTypeId);

  const newAsset = await assetsService.create(db, body);

  return c.json(newAsset, 201);
});

app.openapi(deleteAssetRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  await checkExistence(db, "assets", id);
  await assertCanModifyAsset(db, id, "delete");

  const result = await assetsService.delete(db, id);

  if (!result) {
    throw assetErrors.notFound({ id });
  }

  return c.json(result, 200);
});

export default app;
