/**
 * Lapisan persistensi sederhana berbasis file JSON.
 *
 * Proyek ini sengaja TIDAK menggunakan database server (MySQL/PostgreSQL)
 * agar bisa langsung di-deploy ke platform gratis tanpa provisioning
 * database terpisah. Seluruh state (antrean, pengaturan, log notifikasi)
 * disimpan dalam satu file data/db.json yang dibaca saat startup dan
 * ditulis ulang setiap ada perubahan.
 *
 * Untuk skala produksi yang lebih besar, ganti modul ini dengan koneksi
 * MySQL/PostgreSQL sesuai rencana teknologi pada proposal (Bab II.3) —
 * seluruh pemanggilan db.load()/db.save() di server.js cukup diganti
 * dengan query database tanpa mengubah logika bisnis lainnya.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "db.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load(defaults) {
  ensureDir();
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch (err) {
      console.error("[db] Gagal membaca db.json, menggunakan data default:", err.message);
      return defaults;
    }
  }
  return defaults;
}

let saveTimer = null;

// Debounce penulisan agar tidak menulis disk berkali-kali dalam waktu
// singkat saat ada banyak perubahan beruntun (mis. beberapa request masuk
// bersamaan).
function save(state) {
  ensureDir();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("[db] Gagal menyimpan data:", err.message);
    }
  }, 150);
}

function saveSync(state) {
  ensureDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("[db] Gagal menyimpan data (sync):", err.message);
  }
}

module.exports = { load, save, saveSync, DATA_FILE };
