import type { Reservation, CreateReservationInput } from "./reservations.types";

const reservations: Reservation[] = [];

export const reservationsService = {
  getAll(): Reservation[] {
    return reservations;
  },

  getById(id: string) {
    return reservations.find((r) => r.id === id);
  },

  create(guestUserId: string, input: CreateReservationInput) {
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);

    // basic overlap check (simplified)
    const conflict = reservations.find((r) => {
      return (
        r.apartmentId === input.apartmentId &&
        !(end <= r.startDate || start >= r.endDate)
      );
    });

    if (conflict) {
      throw new Error("Apartment already booked for these dates");
    }

    const reservation: Reservation = {
      id: `res_${Date.now()}`,
      apartmentId: input.apartmentId,
      guestUserId,
      startDate: start,
      endDate: end,
      status: "pending",
    };

    reservations.push(reservation);
    return reservation;
  },
};
