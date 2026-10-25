import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "./error.codes";
import type { ErrorDetail } from "./error.schema";

export interface AppErrorOptions {
  /** Registry code. Not a status name, not free-form. */
  code: ErrorCode;
  /** Final, human-readable, safe to display. Rendered verbatim — never wrapped or prefixed. */
  message: string;
  /** Per-field problems. Only for input-caused failures. */
  details?: ErrorDetail[];
  /** Developer diagnostics: { origin, resource, id, ... }. Stripped in production. */
  meta?: Record<string, unknown>;
}

/** Base class for every error this application throws deliberately. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  readonly meta?: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, opts: AppErrorOptions) {
    super(opts.message);
    this.name = new.target.name;
    this.status = status;
    this.code = opts.code;
    this.details = opts.details;
    this.meta = opts.meta;
  }
}

export class BadRequestException extends AppError {
  /** @deprecated MIGRATION SHIM — pass an AppErrorOptions object instead. Deleted in step 5.8. */
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  /**
   * @deprecated MIGRATION SHIM — the two-argument form `(message, code)`. The plan's Do block
   * expected this shape at only `apartments.service.ts:90,123` (rewritten by step 4.6), but it
   * also appears at `users.route.ts:76,97` (rewritten by step 5.3 / 4.6). Carried so the tree
   * stays green through phases 2–4. Deleted in step 5.3.
   */
  constructor(message: string, code: ErrorCode);
  constructor(arg: AppErrorOptions | string, code?: ErrorCode) {
    super(400, typeof arg === "string" ? { code: code ?? "VALIDATION_ERROR", message: arg } : arg);
  }
}
export class UnauthorizedException extends AppError {
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  /**
   * @deprecated MIGRATION SHIM — the zero-argument form. Kept only because
   * `users.route.ts:88` calls `new UnauthorizedException()`; migrated in step 5.3.
   * Deleted in step 5.8.
   */
  constructor();
  constructor(arg?: AppErrorOptions | string) {
    super(
      401,
      typeof arg === "string"
        ? { code: "AUTH_TOKEN_MISSING", message: arg }
        : arg ?? { code: "AUTH_TOKEN_MISSING", message: "Unauthorized: Missing or invalid token." },
    );
  }
}
export class ForbiddenException extends AppError {
  /** @deprecated MIGRATION SHIM — pass an AppErrorOptions object instead. Deleted in step 5.8. */
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(403, typeof arg === "string" ? { code: "FORBIDDEN_ROLE", message: arg } : arg);
  }
}
export class NotFoundException extends AppError {
  /** @deprecated MIGRATION SHIM — pass an AppErrorOptions object instead. Deleted in step 5.8. */
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(404, typeof arg === "string" ? { code: "ROUTE_NOT_FOUND", message: arg } : arg);
  }
}
export class ConflictException extends AppError {
  /** @deprecated MIGRATION SHIM — pass an AppErrorOptions object instead. Deleted in step 5.8. */
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(409, typeof arg === "string" ? { code: "DUPLICATE_RECORD", message: arg } : arg);
  }
}

/**
 * @deprecated MIGRATION SHIM — the pre-1.3 base class (status + string code + message).
 * Aliased to `AppError` so `index.ts:41`'s `err instanceof CustomException` check keeps
 * working without touching a file outside this step's Touch list. Deleted in step 2.1,
 * which rewrites `index.ts` to throw/route `AppError` directly.
 */
export { AppError as CustomException };

/** Maps a status to its exception class. Used by the declarative `defineErrors` factory. */
export const exceptionForStatus = (
  status: ContentfulStatusCode,
  opts: AppErrorOptions,
): AppError => {
  switch (status) {
    case 400: return new BadRequestException(opts);
    case 401: return new UnauthorizedException(opts);
    case 403: return new ForbiddenException(opts);
    case 404: return new NotFoundException(opts);
    case 409: return new ConflictException(opts);
    default:  return new AppError(status, opts);
  }
};