 import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { usersService } from "../modules/users/users.service";
import { apartmentsService } from "../modules/apartments/apartments.service";
import { reservationsService } from "../modules/reservations/reservations.service";

export const apartmentGuard = (adminAllowed = false) => {
  return createMiddleware<App>(async (c, next) => {
    const db = c.get("db");
    const authUser = c.get("authUser");

    if (!authUser) {
      return c.json({ message: "Unauthorized: Authentication missing" }, 401);
    }

    const user = await usersService.getByAuthId(db, authUser.id);

    if (!user || user.status !== "confirmed") {
      return c.json({ message: "Bad Request: User context missing" }, 400);
    }

    if (adminAllowed && user?.role === "admin") {
      await next();
      return;
    }

    const targetId = c.req.param("apartmentId") || c.req.param("id");

    if (!targetId) {
      return c.json(
        { message: "Bad Request: Missing apartment or reservation parameter in URL path" },
        400,
      );
    }

    let apartment = await apartmentsService.getById(db, targetId);

    if (!apartment) {
      const reservation = await reservationsService.getById(db, targetId);
      if (reservation?.apartmentId) {
        apartment = await apartmentsService.getById(
          db,
          reservation.apartmentId,
        );
      }
    }

    if (!apartment) {
      return c.json({ message: "Not Found: Apartment does not exist" }, 404);
    }

    const apartmentOwnerId = apartment.owner;

    if (apartmentOwnerId !== user?.id) {
      return c.json(
        { message: "Forbidden: You do not have access to this apartment" },
        403,
      );
    }

    await next();
  });
};