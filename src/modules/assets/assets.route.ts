import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getAssetsByApartmentRoute,
  createAssetRoute,
  deleteAssetRoute,
} from "./assets.contract";
import { assetsService } from "./assets.service";
import { NotFoundException } from "@/core/errors/error.exceptions";
import { checkExistence } from "@/core/utils/db-validator";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

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

  const newAsset = await assetsService.create(db, body);

  return c.json(newAsset, 201);
});

app.openapi(deleteAssetRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const result = await assetsService.delete(db, id);

  if (!result) {
    throw new NotFoundException("Asset");
  }

  return c.json(result, 200);
});

export default app;