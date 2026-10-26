import { describe, it, expect } from "vitest";
import { asc } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { assetTypes } from "@/db";
import { assetsService } from "./assets.service";

const dialect = new PgDialect();

/**
 * `orderBy` returns an `SQL` object, not a string, and the service's `db` is a mock in every
 * test in this repo — so the sort direction is otherwise unobservable. Rendering the clause
 * through the real Pg dialect is what makes "sorted A-Z" a test instead of a comment.
 */
const renderOrder = (clause: unknown) => dialect.sqlToQuery((clause as any).getSQL()).sql;

/** Chainable stand-in for the Drizzle query builder; captures the `orderBy` argument. */
const captureDb = (rows: unknown[]) => {
  const calls: { from?: unknown; orderBy?: unknown } = {};
  const chain: any = {
    from: (table: unknown) => {
      calls.from = table;
      return chain;
    },
    orderBy: (clause: unknown) => {
      calls.orderBy = clause;
      return chain;
    },
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  };
  return { db: { select: () => chain } as any, calls };
};

const CATALOG = [
  { id: "770e8400-e29b-41d4-a716-446655440000", code: "COFFEE_MACHINE", category: "APPLIANCES_SMALL" },
  { id: "550e8400-e29b-41d4-a716-446655440000", code: "SMART_LOCK", category: "ELECTRONICS" },
];

describe("assetsService.getAllTypes", () => {
  it("orders by asset_types.code ascending — D4", async () => {
    const { db, calls } = captureDb(CATALOG);

    await assetsService.getAllTypes(db);

    expect(renderOrder(calls.orderBy)).toBe('"asset_types"."code" asc');
  });

  it("does not order descending", async () => {
    const { db, calls } = captureDb(CATALOG);

    await assetsService.getAllTypes(db);

    expect(renderOrder(calls.orderBy)).not.toContain("desc");
  });

  it("reads from the asset_types table", async () => {
    const { db, calls } = captureDb(CATALOG);

    await assetsService.getAllTypes(db);

    expect(calls.from).toBe(assetTypes);
  });

  it("applies no limit and no offset — no pagination (D5)", async () => {
    // The mock chain defines neither `limit` nor `offset`, so a service that called either
    // would dereference undefined and throw instead of resolving.
    let reached = false;
    const chain: any = {
      from: () => chain,
      orderBy: () => chain,
      then: (res: any, rej: any) => {
        reached = true;
        return Promise.resolve(CATALOG).then(res, rej);
      },
    };

    const result = await assetsService.getAllTypes({ select: () => chain } as any);

    expect(reached).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("returns the rows unchanged — no re-sorting in JavaScript", async () => {
    const unsorted = [CATALOG[1], CATALOG[0]];
    const { db } = captureDb(unsorted);

    const result = await assetsService.getAllTypes(db);

    // Identical order to the input: the service must not `.sort()` what the database ordered.
    expect(result).toBe(unsorted);
  });
});
