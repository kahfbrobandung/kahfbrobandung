import { Router, type IRouter } from "express";
import { db, subscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// Endpoint untuk menerima notifikasi dari Lynk.id
router.post("/webhook/lynk", async (req, res) => {
  try {
    const payload = req.body;
    console.log("Menerima webhook dari Lynk.id:", payload);

    // 1. Ambil email pembeli dari data yang dikirim Lynk.id
    // Catatan: Kamu perlu cek format persisnya di dashboard Lynk.id. 
    // Biasanya ada di payload.buyer.email atau payload.customer.email
    const buyerEmail = payload?.buyer?.email || payload?.customer?.email;

    if (!buyerEmail) {
      return res.status(400).json({ error: "Email pembeli tidak ditemukan di payload." });
    }

    // 2. Cari user ID berdasarkan email di tabel auth.users atau public.users
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, buyerEmail))
      .limit(1);

    if (!user) {
      return res.status(404).json({ error: "User dengan email tersebut tidak ditemukan di aplikasi." });
    }

    // 3. Hitung masa aktif baru (tambah 30 hari dari sekarang)
    const newExpiryDate = new Date();
    newExpiryDate.setDate(newExpiryDate.getDate() + 30);

    // 4. Update status langganan user menjadi 'active'
    await db
      .update(subscriptionsTable)
      .set({
        status: "active",
        current_period_ends_at: newExpiryDate,
        updated_at: new Date(),
      })
      .where(eq(subscriptionsTable.userId, user.id));

    console.log(`Langganan untuk ${buyerEmail} berhasil diperpanjang sampai ${newExpiryDate}`);

    // 5. Beri respons sukses ke Lynk.id
    res.status(200).json({ status: "success", message: "Langganan berhasil diperbarui." });
  } catch (error) {
    console.error("Error memproses webhook:", error);
    res.status(500).json({ error: "Terjadi kesalahan internal server." });
  }
});

export default router;