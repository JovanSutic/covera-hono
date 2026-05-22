import { describe, it, expect } from "vitest";
import app from "../../index";

describe("Reservations", () => {
  it("GET /reservations", async () => {
    const res = await app.request("/reservations");

    expect(res.status).toBe(200);
  });

  it("POST /reservations", async () => {
    const res = await app.request("/reservations", {
      method: "POST",
      body: JSON.stringify({
        apartmentId: "apt_1",
        startDate: "2026-01-01",
        endDate: "2026-01-05",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    expect(res.status).toBe(201);
  });
});
