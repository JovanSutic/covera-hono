import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../index";

vi.mock("../../modules/locations/locations.service", () => ({
  locationsService: {
    getAll: vi.fn(),
    create: vi.fn(),
  },
}));

import { locationsService } from "../../modules/locations/locations.service";

const mockedService = locationsService as unknown as {
  getAll: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("Locations routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /locations", async () => {
    mockedService.getAll.mockReturnValue([
      {
        id: VALID_UUID,
        name: "Rome",
        country: "Italy",
        type: "city",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await app.request("/locations");

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(VALID_UUID);
    expect(data[0].name).toBe("Rome");
  });

  it("POST /locations", async () => {
    const input = {
      name: "Rome",
      country: "Italy",
      type: "city",
    };

    mockedService.create.mockReturnValue({
      id: VALID_UUID,
      ...input,
      createdAt: new Date().toISOString(),
    });

    const res = await app.request("/locations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);

    const data = await res.json();

    expect(data.id).toBe(VALID_UUID);
    expect(data.name).toBe("Rome");
    expect(data.country).toBe("Italy");
    expect(data.type).toBe("city");
  });
});