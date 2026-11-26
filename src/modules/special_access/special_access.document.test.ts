import { describe, it, expect } from "vitest";
import app from "@/index";

/**
 * The document at `/openapi.json` IS the frontend's contract — `covera` runs
 * `npm run api:generate` against it. Nothing else in the suite asserts the
 * RENDERED shape: `check-contracts.ts` reads the contract source, and
 * `npm run gate` never builds the document.
 *
 * `app` is imported, not rebuilt, for the same reason `bootstrap.test.ts`
 * imports it: a throwaway copy would keep passing after the real app changed.
 */
interface Operation {
  parameters?: { name: string; in: string }[];
  security?: unknown;
  responses?: Record<
    string,
    { content?: Record<string, { schema?: { $ref?: string } }> }
  >;
}

interface Doc {
  components?: {
    securitySchemes?: Record<string, { type?: string; in?: string; name?: string }>;
  };
  paths?: Record<string, Record<string, Operation>>;
}

/** Paths are keyed by path STRING, so `method` is part of every assertion. */
const TOKEN_ENABLED: Array<[string, string]> = [
  ["/reservations/{id}", "get"],
  ["/reservations/{id}/photos", "get"],
  ["/apartments/{id}", "get"],
  ["/apartment-shots/apartment/{apartmentId}", "get"],
  ["/inspections/reservation/{reservationId}", "get"],
  ["/inspections", "post"],
  ["/incidents/{id}", "get"],
  ["/incidents/{id}/items/{itemId}/upload-tokens", "post"],
  ["/incidents/{id}/items/{itemId}/evidence", "post"],
  ["/assets/apartment/{apartmentId}", "get"],
  ["/apartments/{id}/photos/upload-tokens", "post"],
  ["/apartments/{id}/photos/confirm", "post"],
  ["/reservations/{id}", "patch"],
];

const fetchDoc = async (): Promise<Doc> => {
  const res = await app.request("/openapi.json");

  expect(res.status).toBe(200);

  return (await res.json()) as Doc;
};

const queryNames = (doc: Doc, path: string, method: string): string[] =>
  (doc.paths?.[path]?.[method]?.parameters ?? [])
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => parameter.name);

describe("the document declares the access credential", () => {
  it("registers specialAccess as an apiKey carried in the query", async () => {
    const doc = await fetchDoc();

    expect(doc.components?.securitySchemes?.specialAccess).toMatchObject({
      type: "apiKey",
      in: "query",
      name: "accessId",
    });
  });

  it("marks no operation as REQUIRING that scheme (D7)", async () => {
    const doc = await fetchDoc();

    for (const [path, operations] of Object.entries(doc.paths ?? {})) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(
          operation.security,
          `${method.toUpperCase()} ${path} must not declare security`,
        ).toBeUndefined();
      }
    }
  });

  it.each(TOKEN_ENABLED)(
    "declares accessId as a query parameter on %s %s",
    async (path, method) => {
      const doc = await fetchDoc();

      expect(queryNames(doc, path, method)).toContain("accessId");
    },
  );

  it("answers introspection with the NARROW schema and the list with the named one", async () => {
    const doc = await fetchDoc();

    const refOf = (path: string, method: string) =>
      doc.paths?.[path]?.[method]?.responses?.["200"]?.content?.["application/json"]
        ?.schema?.$ref;

    expect(refOf("/special-access/{accessId}", "get")).toBe(
      "#/components/schemas/SpecialAccessIntrospection",
    );
    expect(refOf("/special-access", "get")).toBe(
      "#/components/schemas/SpecialAccessList",
    );
  });
});
