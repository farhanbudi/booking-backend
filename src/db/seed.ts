// Jalankan dengan: bun run db:seed
// Mengisi beberapa resource contoh supaya frontend langsung bisa dicoba
// tanpa perlu insert manual lewat endpoint admin dulu.

import { db, client } from "./client";
import { resources, users } from "./schema";

async function seed() {
  console.log("🌱 Seeding data...");

  // --- Resources contoh ---
  const seedResources = [
    {
      name: "Meeting Room A",
      capacity: 4,
      location: "Lantai 2, Gedung Utama",
    },
    {
      name: "Meeting Room B",
      capacity: 8,
      location: "Lantai 2, Gedung Utama",
    },
    {
      name: "Ruang Rapat Eksekutif",
      capacity: 12,
      location: "Lantai 5, Gedung Utama",
    },
    {
      name: "Pod Diskusi Kecil",
      capacity: 2,
      location: "Lantai 1, Area Coworking",
    },
  ];

  for (const r of seedResources) {
    await db.insert(resources).values(r);
    console.log(`  ✓ Resource ditambahkan: ${r.name}`);
  }

  // --- Admin user contoh (opsional, memudahkan testing endpoint admin) ---
  const adminEmail = "admin@example.com";
  const adminPassword = "admin12345";

  const passwordHash = await Bun.password.hash(adminPassword);
  await db.insert(users).values({
    name: "Admin",
    email: adminEmail,
    passwordHash,
    role: "admin",
  });

  console.log(`  ✓ Admin user dibuat: ${adminEmail} / ${adminPassword}`);
  console.log("🌱 Seeding selesai.");

  await client.end();
}

seed().catch((err) => {
  console.error("❌ Seeding gagal:", err.message);
  console.error(
    "   (Kalau errornya 'duplicate key', kemungkinan data sudah pernah di-seed sebelumnya.)"
  );
  process.exit(1);
});
