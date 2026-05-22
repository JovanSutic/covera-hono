export type Apartment = {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  address: string;
  createdAt: Date;
};

export type CreateApartmentInput = {
  title: string;
  description?: string;
  address: string;
};
