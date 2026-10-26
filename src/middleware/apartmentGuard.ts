import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { usersService } from "../modules/users/users.service";
import { apartmentsService } from "../modules/apartments/apartments.service";
import { reservationsService } from "../modules/reservations/reservations.service";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@/core/errors/error.exceptions";

export const apartmentGuard = (adminAllowed = false) => {
  return createMiddleware<App>(async (c, next) => {
    const db = c.get("db");
    const authUser = c.get("authUser");

    if (!authUser) {
      throw new UnauthorizedException({
        code: "AUTH_TOKEN_MISSING",
        message: "Authentication is required for this endpoint. Provide a Bearer token.",
        meta: { origin: "GUARD" },
      });
    }

    const user = await usersService.getByAuthId(db, authUser.id);

    if (!user || user.status !== "confirmed") {
      throw new ForbiddenException({
        code: "FORBIDDEN_ROLE",
        message: "Your account is not confirmed, so it cannot access this resource.",
        meta: { origin: "GUARD", status: user?.status },
      });
    }

    if (adminAllowed && user.role === "admin") {
      await next();
      return;
    }

    const targetId = c.req.param("apartmentId") || c.req.param("id");

    if (!targetId) {
      throw new BadRequestException({
        code: "MISSING_REQUIRED_FIELD",
        message: "This endpoint requires an apartment or reservation identifier in the URL path.",
        details: [{ field: "param", message: "Expected an 'apartmentId' or 'id' path parameter." }],
        meta: { origin: "GUARD" },
      });
    }

    // Resolution fallback: the path segment may be an apartment id or a reservation id.
    let apartment = await apartmentsService.getById(db, targetId);

    if (!apartment) {
      const reservation = await reservationsService.getById(db, targetId);
      if (reservation?.apartmentId) {
        apartment = await apartmentsService.getById(db, reservation.apartmentId);
      }
    }

    if (!apartment) {
      throw new NotFoundException({
        code: "APARTMENT_NOT_FOUND",
        message: "Apartment does not exist.",
        meta: { origin: "GUARD", id: targetId },
      });
    }

    if (apartment.owner !== user.id) {
      throw new ForbiddenException({
        code: "FORBIDDEN_APARTMENT_ACCESS",
        message: "You do not have access to this apartment.",
        meta: { origin: "GUARD", apartmentId: apartment.id },
      });
    }

    await next();
  });
};
