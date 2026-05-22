import type { Apartment, CreateApartmentInput } from "./apartments.types";

const apartments: Apartment[] = [
  {
    id: "apt_1",
    ownerId: "usr_2",
    title: "Rome Center Apartment",
    description: "Nice place in the center",
    address: "Via Roma 10",
    createdAt: new Date(),
  },
];

export const apartmentsService = {
  getAll(): Apartment[] {
    return apartments;
  },

  getById(id: string): Apartment | undefined {
    return apartments.find((a) => a.id === id);
  },

  create(ownerId: string, input: CreateApartmentInput): Apartment {
    const newApartment: Apartment = {
      id: `apt_${Date.now()}`,
      ownerId,
      createdAt: new Date(),
      ...input,
    };

    apartments.push(newApartment);
    return newApartment;
  },
};
