import { createMiddleware } from "hono/factory";
import { env } from "hono/adapter";
import { S3Client } from "@aws-sdk/client-s3";
import { App } from "@/types";
import { AppError } from "@/core/errors/error.exceptions";

export const s3Middleware = createMiddleware<App>(async (c, next) => {
  const runtimeEnv = env<App["Bindings"]>(c);

  const endpointUrl = runtimeEnv.R2_ENDPOINT_URL;
  const accessKeyId = runtimeEnv.R2_ACCESS_KEY_ID;
  const secretAccessKey = runtimeEnv.R2_SECRET_ACCESS_KEY;
  const bucketName = runtimeEnv.R2_BUCKET_NAME;

  if (!endpointUrl || !accessKeyId || !secretAccessKey) {
    throw new AppError(500, {
      code: "HTTP_ERROR",
      message: "The service is not correctly configured and cannot serve requests right now.",
      meta: { origin: "BOOTSTRAP", missing: "R2_ENDPOINT_URL|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY" },
    });
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint: endpointUrl,
    credentials: {
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    },
  });

  c.set("s3", s3);
  c.set("r2BucketName", bucketName);

  await next();
});
