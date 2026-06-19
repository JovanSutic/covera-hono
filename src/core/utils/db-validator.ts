import { eq } from "drizzle-orm";
import { users } from "@/db/schema/users";
import { locations } from "@/db/schema/locations";
import { apartments } from "@/db/schema/apartments";
import { NotFoundException } from "@/core/errors/error.exceptions";

const schemaRegistry = {
  users: users,
  locations: locations,
  apartments: apartments,
} as const;

type ResourceType = keyof typeof schemaRegistry;

export async function checkExistence(
  db: any,
  resource: ResourceType,
  id: string
): Promise<void> {
  const table = schemaRegistry[resource];

  if (!table) {
    throw new Error(`Developer Error: Resource '${resource}' is not registered in checkExistence schemaRegistry.`);
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
