import { createMiddleware } from "hono/factory";
import { env } from "hono/adapter";
import { S3Client } from "@aws-sdk/client-s3";
import { App } from "@/types";

export const s3Middleware = createMiddleware<App>(async (c, next) => {
  const runtimeEnv = env<App["Bindings"]>(c);

  const endpointUrl = runtimeEnv.R2_ENDPOINT_URL;
  const accessKeyId = runtimeEnv.R2_ACCESS_KEY_ID;
  const secretAccessKey = runtimeEnv.R2_SECRET_ACCESS_KEY;
  const bucketName = runtimeEnv.R2_BUCKET_NAME;

  if (!endpointUrl || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing Cloudflare R2 configuration environment variables.");
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
