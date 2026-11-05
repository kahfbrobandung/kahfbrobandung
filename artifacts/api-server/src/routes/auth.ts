import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";

const router = Router();

// Kunci rahasia untuk membuat token login (Nanti kita simpan di Vercel)
const JWT_SECRET = process.env.JWT_SECRET || "rahasia-erlangga-super-aman-2026";

// Validasi input
const authSchema = z.object({
  email: z.string().email("Format email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter"),
  name: z.string().min(2, "Nama minimal 2 karakter").optional(),
});

// ROUTE: REGISTER (Daftar Akun Baru)
router.post("/register", async (req, res): Promise<void> => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { email, password, name } = parsed.data;

  try {
    // Cek apakah email sudah terdaftar
    const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(400).json({ error: "Email sudah terdaftar. Silakan login." });
      return;
    }

    // Acak password agar aman
    const passwordHash = await bcrypt.hash(password, 10);

    // Simpan ke database
    const [newUser] = await db.insert(usersTable).values({
      email,
      passwordHash,
      name: name || email.split("@")[0], // Kalau nama kosong, pakai nama depan email
    }).returning();

    // Buat token login
    const token = jwt.sign({ userId: newUser.id, role: newUser.role }, JWT_SECRET, { expiresIn: "30d" });

    res.status(201).json({
      message: "Registrasi berhasil",
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role }
    });
  } catch (error) {
    res.status(500).json({ error: "Terjadi kesalahan pada server saat mendaftar." });
  }
});

// ROUTE: LOGIN (Masuk ke Akun)
router.post("/login", async (req, res): Promise<void> => {
  const parsed = authSchema.omit({ name: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0].message });
    return;
  }

  const { email, password } = parsed.data;

  try {
    // Cari user berdasarkan email
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user) {
      res.status(401).json({ error: "Email atau password salah." });
      return;
    }

    // Cocokkan password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: "Email atau password salah." });
      return;
    }

    // Buat token login
    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: "30d" });

    res.json({
      message: "Login berhasil",
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ error: "Terjadi kesalahan pada server saat login." });
  }
});

export default router;
