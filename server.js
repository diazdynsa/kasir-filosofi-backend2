const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg'); // Driver PostgreSQL
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// --- KONEKSI KE SUPABASE (POSTGRESQL) ---
// 👇👇 PASTE LINK SUPABASE DI SINI 👇👇
const connectionString = 'postgresql://postgres.mfdhpnjspbbinexxnayz:Dynsaputra09@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres';

const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false } // Wajib buat Supabase
});

// --- INISIALISASI TABEL (AUTO-MIGRATE) ---
async function initDB() {
    try {
        // 1. Buat Tabel Products
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                cat TEXT NOT NULL,
                price INT NOT NULL,
                stock INT NOT NULL
            );
        `);

        // 2. Buat Tabel Transactions
        // Kita simpan 'items' sebagai JSONB (Fitur keren Postgres)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                trx_id TEXT PRIMARY KEY,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                items JSONB NOT NULL,
                total INT NOT NULL
            );
        `);

        // 3. Seeding Data (Isi data awal kalo kosong)
        const res = await pool.query('SELECT COUNT(*) FROM products');
        if (parseInt(res.rows[0].count) === 0) {
            const sql = `INSERT INTO products (name, cat, price, stock) VALUES ($1, $2, $3, $4)`;
            await pool.query(sql, ["Kopi Susu Senja", "Coffee", 18000, 50]);
            await pool.query(sql, ["V60 Arabika", "Coffee", 22000, 30]);
            await pool.query(sql, ["Green Tea Latte", "Non-Coffee", 24000, 40]);
            await pool.query(sql, ["Nasi Goreng", "Makanan", 30000, 20]);
            await pool.query(sql, ["Roti Bakar", "Snack", 15000, 25]);
            console.log("🌱 Data awal berhasil ditanam ke Supabase!");
        } else {
            console.log("✅ Database Supabase Siap & Terkoneksi!");
        }

    } catch (err) {
        console.error("❌ Gagal Init DB:", err);
    }
}
initDB();

// --- API ENDPOINTS (Versi SQL) ---

// 1. Get Products
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({error: err.message}); }
});

// 2. Add/Edit Product
app.post('/api/products', async (req, res) => {
    const { id, name, cat, price, stock } = req.body;
    
    try {
        if (id) {
            // Update
            await pool.query(
                'UPDATE products SET name=$1, cat=$2, price=$3, stock=$4 WHERE id=$5',
                [name, cat, price, stock, id]
            );
        } else {
            // Create New (ID otomatis nambah karena SERIAL)
            await pool.query(
                'INSERT INTO products (name, cat, price, stock) VALUES ($1, $2, $3, $4)',
                [name, cat, price, stock]
            );
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({error: err.message}); }
});

// 3. Delete Product
app.delete('/api/products/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({error: err.message}); }
});

// 4. Transaction
app.post('/api/transaction', async (req, res) => {
    const { items, total } = req.body;
    const client = await pool.connect(); // Pake client buat Transaction (ACID)
    
    try {
        await client.query('BEGIN'); // Mulai Transaksi

        // Cek & Kurangi Stok
        for (const item of items) {
            const res = await client.query('SELECT stock FROM products WHERE id = $1', [item.id]);
            const currentStock = res.rows[0].stock;

            if (currentStock < item.qty) {
                throw new Error(`Stok ${item.name} tidak cukup!`);
            }

            await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.qty, item.id]);
        }

        // Simpan Riwayat
        const trxId = 'TRX-' + Date.now();
        await client.query(
            'INSERT INTO transactions (trx_id, items, total) VALUES ($1, $2, $3)',
            [trxId, JSON.stringify(items), total]
        );

        await client.query('COMMIT'); // Simpan permanen
        res.json({ success: true });

    } catch (err) {
        await client.query('ROLLBACK'); // Batalin semua kalo error
        res.status(400).json({ error: err.message });
    } finally {
        client.release();
    }
});

// 5. Dashboard Stats
app.get('/api/dashboard', async (req, res) => {
    try {
        const prodRes = await pool.query('SELECT COUNT(*) FROM products');
        
        // Hitung transaksi hari ini (Logic SQL)
        const trxRes = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as revenue 
            FROM transactions 
            WHERE date >= CURRENT_DATE
        `);

        res.json({
            totalProducts: prodRes.rows[0].count,
            todaySales: trxRes.rows[0].count,
            todayRevenue: parseInt(trxRes.rows[0].revenue)
        });
    } catch (err) { res.status(500).json({error: err.message}); }
});

app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di Port ${PORT}`);
});
module.exports = app;