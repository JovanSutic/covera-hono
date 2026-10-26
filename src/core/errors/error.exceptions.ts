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
  constructor(opts: AppErrorOptions) { super(400, opts); }
}
export class UnauthorizedException extends AppError {
  constructor(opts: AppErrorOptions) { super(401, opts); }
}
export class ForbiddenException extends AppError {
  constructor(opts: AppErrorOptions) { super(403, opts); }
}
export class NotFoundException extends AppError {
  constructor(opts: AppErrorOptions) { super(404, opts); }
}
export class ConflictException extends AppError {
  constructor(opts: AppErrorOptions) { super(409, opts); }
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