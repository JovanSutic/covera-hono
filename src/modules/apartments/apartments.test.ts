import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../index";

vi.mock("../../modules/apartments/apartments.service", () => ({
  apartmentsService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
  },
}));

import { apartmentsService } from "../../modules/apartments/apartments.service";

const mockedService = apartmentsService as unknown as {
  getAll: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const uuid = '550e8400-e29b-41d4-a716-446655440000';

describe("Apartments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /apartments", async () => {
    mockedService.getAll.mockReturnValue([
      {
        id: "apt_1",
        owner: "usr_1",
        location: "loc_1",
        name: "Test apartment",
        address: "Rome",
        externalId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await app.request("/apartments");

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe("Test apartment");
  });

  it("GET /apartments/:id", async () => {
    mockedService.getById.mockReturnValue({
      id: uuid,
      owner: uuid,
      location: uuid,
      name: "Test apartment",
      address: "Rome",
      externalId: null,
      createdAt: new Date().toISOString(),
    });

    const res = await app.request(`/apartments/${uuid}`);

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.id).toBe(uuid);
  });

  it("POST /apartments", async () => {
    const input = {
      owner: uuid,
      location: uuid,
      name: "New apartment",
      address: "Rome",
      externalId: "ext_123",
    };

    mockedService.create.mockReturnValue({
      id: uuid,
      ...input,
      createdAt: new Date().toISOString(),
    });

    const res = await app.request("/apartments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);

    const data = await res.json();

    expect(data.name).toBe("New apartment");

    expect(mockedService.create).toHaveBeenCalledWith(input);
  });
});
