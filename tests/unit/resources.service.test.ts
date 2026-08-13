import { describe, expect, test, beforeAll } from "bun:test";
import {
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
} from "../../src/modules/resources/resources.service";
import { NotFoundError } from "../../src/utils/errors";
import { resetDb } from "../helpers/test-db";

beforeAll(async () => {
  await resetDb();
});

describe("resources.service", () => {
  test("listResources hanya mengembalikan resource aktif", async () => {
    await createResource({ name: "Aktif 1", capacity: 4 });
    const nonAktif = await createResource({ name: "Nonaktif", capacity: 8 });
    await deleteResource(nonAktif.id);

    const result = await listResources();
    expect(result.some((r) => r.id === nonAktif.id)).toBe(false);
    expect(result.some((r) => r.name === "Aktif 1")).toBe(true);
  });

  test("listResources dengan minCapacity memfilter sesuai kapasitas", async () => {
    await createResource({ name: "Kecil", capacity: 2 });
    await createResource({ name: "Besar", capacity: 10 });

    const result = await listResources({ minCapacity: 5 });
    expect(result.every((r) => r.capacity >= 5)).toBe(true);
    expect(result.some((r) => r.name === "Besar")).toBe(true);
    expect(result.some((r) => r.name === "Kecil")).toBe(false);
  });

  test("getResourceById melempar NotFoundError untuk id yang tidak ada", async () => {
    try {
      await getResourceById("00000000-0000-0000-0000-000000000000");
      throw new Error("getResourceById seharusnya melempar NotFoundError");
    } catch (e) {
      expect(e).toBeInstanceOf(NotFoundError);
    }
  });

  test("updateResource memperbarui data resource", async () => {
    const created = await createResource({ name: "Sebelum", capacity: 4 });
    const updated = await updateResource(created.id, { name: "Sesudah", capacity: 6 });

    expect(updated.name).toBe("Sesudah");
    expect(updated.capacity).toBe(6);
  });

  test("deleteResource melakukan soft delete (isActive false)", async () => {
    const created = await createResource({ name: "Akan Dihapus", capacity: 4 });
    const deleted = await deleteResource(created.id);

    expect(deleted.isActive).toBe(false);
  });
});
