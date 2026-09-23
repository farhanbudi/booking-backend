// Data awal contoh. Dipakai lewat `bun run db:seed` (database development) dan
// otomatis oleh `bun run test:server` (database test untuk e2e). Catatan: seed
// tidak idempoten untuk resource & akun admin yang sama, jadi pastikan database
// dalam keadaan kosong (misal setelah reset) sebelum memanggilnya.

import { db, client } from "./client";
import { resources, users } from "./schema";

export async function seedDatabase(): Promise<void> {
  console.log("🌱 Seeding data...");

  // --- Resources contoh ---
  const seedResources = [
    {
      name: "Meeting Room A",
      capacity: 4,
      location: "Lantai 2, Gedung Utama",
      pricePerHour: 50000,
    },
    {
      name: "Meeting Room B",
      capacity: 8,
      location: "Lantai 2, Gedung Utama",
      pricePerHour: 100000,
    },
    {
      name: "Ruang Rapat Eksekutif",
      capacity: 12,
      location: "Lantai 5, Gedung Utama",
      pricePerHour: 200000,
    },
    {
      name: "Pod Diskusi Kecil",
      capacity: 2,
      location: "Lantai 1, Area Coworking",
      pricePerHour: 0,
    },
  ];

  for (const r of seedResources) {
    await db.insert(resources).values(r);
    console.log(`  ✓ Resource ditambahkan: ${r.name}`);
  }

  // --- Admin user contoh (memudahkan testing endpoint admin) ---
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin12345";

  const passwordHash = await Bun.password.hash(adminPassword);
  await db.insert(users).values({
    name: "Admin",
    email: adminEmail,
    passwordHash,
    role: "admin",
  });

  console.log(`  ✓ Admin user dibuat: ${adminEmail}`);
  console.log("🌱 Seeding selesai.");
}

// Saat dijalankan langsung (`bun run db:seed`), tutup koneksi setelah selesai.
// Ketika di-import (misal oleh test:server), koneksi dibiarkan terbuka supaya
// server tetap bisa memakai database yang sama.
if (import.meta.main) {
  seedDatabase()
    .then(() => client.end())
    .catch((err) => {
      console.error("❌ Seeding gagal:", err.message);
      console.error(
        "   (Kalau errornya 'duplicate key', kemungkinan data sudah pernah di-seed sebelumnya.)"
      );
      process.exit(1);
    });
}