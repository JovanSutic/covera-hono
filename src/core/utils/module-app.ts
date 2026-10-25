import { OpenAPIHono } from "@hono/zod-openapi";
import { validationHook } from "@/core/errors/error.handler";
import { App } from "@/types";

/**
 * Creates the `OpenAPIHono` instance for a module's route file.
 *
 * Use this instead of `new OpenAPIHono<App>()`. `defaultHook` is read off the instance at the
 * moment `app.openapi()` runs, so a sub-app constructed without it validates with no hook at
 * all and `zValidator` answers with its raw `{ success: false, error: ZodError }` payload —
 * bypassing `renderError` and leaking Zod's own text. The parent app's `defaultHook` does not
 * cover a sub-app mounted with `.route()`.
 *
 * Errors thrown by handlers and guards are unaffected: they propagate to the parent's
 * `onError`, which is the single place the envelope is built.
 */
export const createModuleApp = () => new OpenAPIHono<App>({ defaultHook: validationHook });
