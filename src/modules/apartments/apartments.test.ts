import { describe, it, expect } from "vitest";
import app from "../../index";

describe("Apartments", () => {
  it("GET /apartments", async () => {
    const res = await app.request("/apartments");

    expect(res.status).toBe(200);
  });

  it("POST /apartments", async () => {
    const res = await app.request("/apartments", {
      method: "POST",
      body: JSON.stringify({
        title: "Test apartment",
        address: "Rome",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(201);
  });
});
