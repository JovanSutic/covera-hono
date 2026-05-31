import type { Location, NewLocation } from "@/db";

const locations: Location[] = [
  {
    id: "loc_1",
    name: "Rome",
    country: "Italy",
    type: "city",
    createdAt: new Date(),
  },
];

export const locationsService = {
  async getAll(): Promise<Location[]> {
    return locations;
  },

  async create(input: NewLocation): Promise<Location> {
    const newLocation: Location = {
      id: `loc_${Date.now()}`,
      createdAt: new Date(),
      ...input,
    };

    locations.push(newLocation);
    return newLocation;
  },
};