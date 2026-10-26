import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ERROR_REGISTRY, type ErrorCode } from "./error.codes";

/** Walks the `cause` chain for a Postgres SQLSTATE (5 chars, e.g. "23505"). */
const findSqlState = (
  err: unknown,
): { code?: string; constraint?: string; message?: string } => {
  let current: any = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
      return { code: current.code, constraint: current.constraint_name, message: current.message };
    }
    current = current.cause;
  }
  return {};
};

/** SQLSTATE → client-facing response. The DB's own text never reaches the client. */
const SQLSTATE_MAP: Record<string, { status: ContentfulStatusCode; code: ErrorCode; message: string }> = {
  "23505": { status: 409, code: "DUPLICATE_RECORD",        message: "A record with these values already exists." },
  "23503": { status: 409, code: "RELATED_RECORD_INVALID",  message: "A referenced record does not exist or is still in use." },
  "23502": { status: 400, code: "MISSING_REQUIRED_FIELD",  message: "A required field was missing from the request." },
  "23514": { status: 400, code: "CONSTRAINT_VIOLATION",    message: "The submitted values violate a data rule." },
  "22P02": { status: 400, code: "INVALID_IDENTIFIER",      message: "One of the identifiers in the request is not a valid value." },
  "22007": { status: 400, code: "INVALID_DATETIME",        message: "One of the dates in the request is not a valid date." },
  "22008": { status: 400, code: "INVALID_DATETIME",        message: "One of the dates in the request is not a valid date." },
};

/**
 * Constraint-name overrides. Checked before the SQLSTATE default.
 * Names verified against drizzle/*.sql.
 */
const CONSTRAINT_MESSAGES: Record<string, { code: ErrorCode; message: string }> = {
  // Unique (SQLSTATE 23505)
  users_email_unique: {
    code: "DUPLICATE_RECORD",
    message: "A user with this email address already exists.",
  },
  users_auth_id_unique: {
    code: "DUPLICATE_RECORD",
    message: "This account is already linked to a user.",
  },
  asset_types_code_unique: {
    code: "DUPLICATE_RECORD",
    message: "An asset type with this code already exists.",
  },
  apartment_images_storage_key_unique: {
    code: "DUPLICATE_RECORD",
    message: "This photo has already been uploaded.",
  },
  apartment_shot_assets_shot_id_asset_id_pk: {
    code: "DUPLICATE_RECORD",
    message: "This asset is already linked to this shot.",
  },
  inspection_flag_assets_flag_id_asset_id_pk: {
    code: "DUPLICATE_RECORD",
    message: "This asset is already linked to this flag.",
  },

  // Foreign keys (SQLSTATE 23503)
  assets_asset_type_id_asset_types_id_fk: {
    code: "ASSET_TYPE_INVALID",
    message: "The asset type you selected does not exist. Choose one from GET /assets/types.",
  },
  apartments_owner_users_id_fk: {
    code: "USER_NOT_FOUND",
    message: "The selected owner does not exist.",
  },
  apartments_location_locations_id_fk: {
    code: "LOCATION_NOT_FOUND",
    message: "The selected location does not exist.",
  },
};

/**
 * Maps a driver error onto a client-facing response, or `null` when the error carries no
 * recognised SQLSTATE. A constraint-name override wins over the SQLSTATE default and takes
 * its status from the registry, so an overridden code's status is the registry's.
 */
export const mapPersistenceError = (
  err: unknown,
): { status: ContentfulStatusCode; code: ErrorCode; message: string; meta: Record<string, unknown> } | null => {
  const pg = findSqlState(err);
  if (!pg.code) return null;

  const meta = { origin: "PERSISTENCE", sqlstate: pg.code, constraint: pg.constraint, driver: pg.message };

  const override = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
  if (override) {
    return {
      status: ERROR_REGISTRY[override.code].status,
      code: override.code,
      message: override.message,
      meta,
    };
  }

  const mapped = SQLSTATE_MAP[pg.code];
  if (!mapped) return null;

  return {
    status: mapped.status,
    code: mapped.code,
    message: mapped.message,
    meta,
  };
};
