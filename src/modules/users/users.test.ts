import { describe, it, expect } from "vitest";
import app from "../../index";

describe("Users routes", () => {
  it("GET /users should return all users", async () => {
    const res = await app.request("/users");

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /users/:id should return single user", async () => {
    const res = await app.request("/users/usr_1");

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.id).toBe("usr_1");
  });

  it("GET /users/:id should return 404", async () => {
    const res = await app.request("/users/unknown");

    expect(res.status).toBe(404);
  });
});
