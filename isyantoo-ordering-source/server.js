const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const sessions = new Map();
function makeToken() {
  return crypto.randomBytes(32).toString("hex");
}
function adminAuth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !sessions.has(token)) return res.status(401).json({ error: "Silakan login sebagai admin." });
  next();
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT DEFAULT '',
      category VARCHAR(40) NOT NULL DEFAULT 'Makanan',
      price INTEGER NOT NULL CHECK (price >= 0),
      image_url TEXT DEFAULT '',
      available BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      customer_name VARCHAR(120) NOT NULL,
      whatsapp VARCHAR(30) NOT NULL,
      notes TEXT DEFAULT '',
      items JSONB NOT NULL,
      total INTEGER NOT NULL CHECK (total >= 0),
      status VARCHAR(30) NOT NULL DEFAULT 'Baru',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM menu_items");
  if (count.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO menu_items (name, description, category, price, image_url) VALUES
      ('Nasi Ayam Geprek', 'Ayam crispy, sambal, nasi hangat', 'Makanan', 18000, ''),
      ('Mie Goreng Spesial', 'Mie goreng dengan telur dan sayuran', 'Makanan', 15000, ''),
      ('Roti Bakar Cokelat', 'Roti panggang dengan cokelat', 'Snack', 12000, ''),
      ('Es Teh Manis', 'Teh segar dengan es', 'Minuman', 5000, ''),
      ('Kopi Susu', 'Kopi susu gula aren', 'Minuman', 12000, '')`
    );
  }
}

app.get("/api/menu", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, description, category, price, image_url FROM menu_items WHERE available = TRUE ORDER BY id");
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: "Gagal mengambil menu." }); }
});

app.post("/api/orders", async (req, res) => {
  const { customer_name, whatsapp, notes = "", items } = req.body;
  if (!customer_name || !whatsapp || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "Nama, WhatsApp, dan minimal satu item wajib diisi." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = items.map(x => Number(x.id)).filter(Number.isInteger);
    const menu = await client.query("SELECT id, name, price FROM menu_items WHERE available = TRUE AND id = ANY($1::int[])", [ids]);
    const byId = new Map(menu.rows.map(x => [x.id, x]));
    let total = 0;
    const verified = [];
    for (const item of items) {
      const product = byId.get(Number(item.id));
      const qty = Math.max(0, Math.min(99, Number(item.quantity) || 0));
      if (!product || qty < 1) throw new Error("Item menu tidak valid.");
      total += product.price * qty;
      verified.push({ id: product.id, name: product.name, price: product.price, quantity: qty });
    }
    const result = await client.query(
      "INSERT INTO orders (customer_name, whatsapp, notes, items, total) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [customer_name.trim(), whatsapp.trim(), String(notes).slice(0, 500), JSON.stringify(verified), total]
    );
    await client.query("COMMIT");
    res.status(201).json({ message: "Pesanan berhasil dikirim.", order_id: result.rows[0].id, total });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: e.message || "Pesanan gagal disimpan." });
  } finally { client.release(); }
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: "Username atau password salah." });
  const token = makeToken();
  sessions.set(token, true);
  res.json({ token });
});

app.get("/api/admin/orders", adminAuth, async (req, res) => {
  try {
    const result = await pool.query("SELECT id, customer_name, whatsapp, notes, items, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 200");
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: "Gagal mengambil pesanan." }); }
});

app.patch("/api/admin/orders/:id", adminAuth, async (req, res) => {
  const allowed = ["Baru", "Diproses", "Selesai", "Dibatalkan"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ error: "Status tidak valid." });
  try {
    const result = await pool.query("UPDATE orders SET status=$1 WHERE id=$2 RETURNING id", [req.body.status, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Pesanan tidak ditemukan." });
    res.json({ message: "Status diperbarui." });
  } catch (e) { res.status(500).json({ error: "Gagal memperbarui status." }); }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`Isyantoo Ordering berjalan di port ${PORT}`));
}).catch(err => {
  console.error("Gagal menyiapkan database:", err.message);
  process.exit(1);
});
