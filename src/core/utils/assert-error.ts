import { expect } from "vitest";

/**
 * Asserts the canonical error envelope.
 * Usage: await expectError(res, 409, "ASSET_LOCKED", /cannot be deleted/);
 */
export const expectError = async (
  res: Response,
  status: number,
  code: string,
  messagePattern?: RegExp,
) => {
  expect(res.status).toBe(status);
  const body: any = await res.json();

  expect(body.success).toBe(false);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
  // Messages are product copy: no status prefix, no raw internals.
  expect(body.error.message).not.toMatch(/^(Not Found|Conflict|Bad Request|Forbidden|Unauthorized):/);
  expect(body.error.message).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|constraint|relation|column)\b/i);

  if (messagePattern) expect(body.error.message).toMatch(messagePattern);
  return body;
};
