export type ReservationStatus = "pending" | "confirmed" | "cancelled";

export type Reservation = {
  id: string;
  apartmentId: string;
  guestUserId: string;
  startDate: Date;
  endDate: Date;
  status: ReservationStatus;
};

export type CreateReservationInput = {
  apartmentId: string;
  startDate: string;
  endDate: string;
};
