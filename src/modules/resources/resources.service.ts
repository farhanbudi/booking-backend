import { and, eq, gte } from "drizzle-orm";
import { db } from "../../db/client";
import { resources } from "../../db/schema";
import { NotFoundError } from "../../utils/errors";

export async function listResources(filters?: { minCapacity?: number }) {
  if (filters?.minCapacity) {
    return db.query.resources.findMany({
      where: and(
        eq(resources.isActive, true),
        gte(resources.capacity, filters.minCapacity)
      ),
    });
  }

  return db.query.resources.findMany({
    where: eq(resources.isActive, true),
  });
}

export async function getResourceById(id: string) {
  const resource = await db.query.resources.findFirst({
    where: eq(resources.id, id),
  });
  if (!resource) {
    throw new NotFoundError("Resource tidak ditemukan");
  }
  return resource;
}

export async function createResource(input: {
  name: string;
  capacity: number;
  location?: string;
}) {
  const [resource] = await db.insert(resources).values(input).returning();
  return resource;
}

export async function updateResource(
  id: string,
  input: Partial<{ name: string; capacity: number; location: string; isActive: boolean }>
) {
  await getResourceById(id); // memastikan resource ada, kalau tidak lempar 404
  const [updated] = await db
    .update(resources)
    .set(input)
    .where(eq(resources.id, id))
    .returning();
  return updated;
}

export async function deleteResource(id: string) {
  await getResourceById(id);
  // Soft delete: cukup nonaktifkan, jangan hapus fisik supaya histori booking tetap valid.
  const [updated] = await db
    .update(resources)
    .set({ isActive: false })
    .where(eq(resources.id, id))
    .returning();
  return updated;
}
