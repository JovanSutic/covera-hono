import { eq } from "drizzle-orm";
import { users } from "@/db/schema/users";
import { locations } from "@/db/schema/locations";
import { apartments } from "@/db/schema/apartments";
import {
  NotFoundException,
  ForbiddenException,
} from "@/core/errors/error.exceptions";

const schemaRegistry = {
  users: users,
  locations: locations,
  apartments: apartments,
} as const;

interface OwnershipContext {
  userId: string;
  role?: string;
  allowAdmin?: boolean;
}

type ResourceType = keyof typeof schemaRegistry;

export async function checkExistence(
  db: any,
  resource: ResourceType,
  id: string,
): Promise<void> {
  const table = schemaRegistry[resource];

  if (!table) {
    throw new Error(
      `Developer Error: Resource '${resource}' is not registered in checkExistence schemaRegistry.`,
    );
  }

  const result = await db
    .select({ id: (table as any).id })
    .from(table)
    .where(eq((table as any).id, id))
    .limit(1);

  if (result.length === 0) {
    throw new NotFoundException(`${resource.slice(0, -1)} with ID ${id}`);
  }
}

export async function assertApartmentOwnership(
  db: any,
  apartmentId: string,
  context: OwnershipContext,
): Promise<void> {
  const { userId, role, allowAdmin = true } = context;

  if (allowAdmin && role === "admin") {
    return;
  }

  const [apartment] = await db
    .select({ owner: apartments.owner })
    .from(apartments)
    .where(eq(apartments.id, apartmentId))
    .limit(1);

  if (!apartment) {
    throw new NotFoundException(`Apartment with ID ${apartmentId} not found`);
  }

  if (apartment.owner !== userId) {
    throw new ForbiddenException(
      "You do not have permission to modify or create resources for this apartment",
    );
  }
}
