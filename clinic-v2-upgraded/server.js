/**
 * Sistem Manajemen Antrean Klinik Kampus
 * Backend: Express + Socket.io + persistensi file JSON
 */

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const db = require("./db");

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

// Diperlukan agar express-rate-limit & req.ip akurat saat berjalan di
// belakang reverse proxy platform deploy (Render/Railway/Fly/Nginx, dll).
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // dimatikan agar tidak konflik dgn CDN socket.io di frontend statis
  })
);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev"));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // maks 60 request/menit per IP untuk endpoint yang mengubah data
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan, coba lagi sebentar." },
});

app.use(express.static(path.join(__dirname, "public")));

// ============== DATA STORE (persisten via file JSON) ==============
const DEFAULT_STATE = {
  queues: [],
  notifLog: [],
  nextId: 1,
  dailyCounter: { date: null, value: 0 },
  settings: {
    jamBuka: "08:00",
    jamTutup: "16:00",
    kapasitasHarian: 50,
    durasiLayananMenit: 5,
  },
};

let state = db.load(DEFAULT_STATE);
let { queues, notifLog, nextId, dailyCounter, settings } = state;

const STAFF_PASSWORD = process.env.STAFF_PASSWORD || "klinik123";
if (!process.env.STAFF_PASSWORD) {
  console.warn(
    "[peringatan] STAFF_PASSWORD tidak diset di environment variable. " +
      `Menggunakan password default "${STAFF_PASSWORD}". Set STAFF_PASSWORD di .env untuk produksi.`
  );
}

const LAYANAN_LIST = [
  "Konsultasi Umum",
  "Pengambilan Obat",
  "Pemeriksaan Kesehatan",
  "Konsultasi Gizi",
];

function persist() {
  db.save({ queues, notifLog, nextId, dailyCounter, settings });
}

// ============== HELPER ==============
function todayStr() {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60000);
  return local.toISOString().slice(0, 10);
}

function nowHHMM() {
  return new Date().toTimeString().slice(0, 5);
}

function isWithinOperationalHours() {
  const now = nowHHMM();
  return now >= settings.jamBuka && now <= settings.jamTutup;
}

function getNextNumber() {
  const today = todayStr();
  if (dailyCounter.date !== today) {
    dailyCounter.date = today;
    dailyCounter.value = 0;
  }
  dailyCounter.value += 1;
  return dailyCounter.value;
}

function todaysQueues() {
  const today = todayStr();
  return queues.filter((q) => q.createdAt.slice(0, 10) === today);
}

function waitingQueueSorted() {
  return todaysQueues()
    .filter((q) => q.status === "menunggu")
    .sort((a, b) => a.nomorUrut - b.nomorUrut);
}

function broadcastQueueUpdate() {
  io.emit("queue-updated", { queues: todaysQueues(), settings });
}

function recomputePositionsAndNotify() {
  const waiting = waitingQueueSorted();
  waiting.forEach((q, idx) => {
    const position = idx;
    if (position === 2 && !q.notified2) {
      q.notified2 = true;
      const msg = `Halo ${q.nama}, antrean Anda (${q.nomorLabel}) tersisa 2 nomor. Mohon segera menuju klinik.`;
      notifLog.push({ nim: q.nim, message: msg, time: new Date().toISOString() });
      io.to(q.nim).emit("notifikasi", { message: msg, nomorLabel: q.nomorLabel });
    }
  });
}

function withComputed(q) {
  const waiting = waitingQueueSorted();
  let position = null;
  if (q.status === "menunggu") {
    position = waiting.findIndex((w) => w.id === q.id);
  }
  const estimasiMenit =
    position !== null && position >= 0 ? position * settings.durasiLayananMenit : null;
  return { ...q, position, estimasiMenit };
}

// ============== HEALTH CHECK (untuk platform deploy) ==============
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), uptime: process.uptime() });
});

// ============== ROUTES: UMUM ==============
app.get("/api/layanan", (req, res) => {
  res.json({ layanan: LAYANAN_LIST });
});

app.get("/api/settings", (req, res) => {
  res.json(settings);
});

// ============== ROUTES: MAHASISWA ==============
app.post("/api/login", apiLimiter, (req, res) => {
  const { nim, nama } = req.body || {};
  if (!nim || !nama) {
    return res.status(400).json({ error: "NIM dan Nama wajib diisi." });
  }
  if (!/^[0-9]{5,15}$/.test(nim)) {
    return res.status(400).json({ error: "Format NIM tidak valid." });
  }
  if (nama.trim().length < 2 || nama.length > 100) {
    return res.status(400).json({ error: "Nama tidak valid." });
  }
  res.json({ ok: true, nim, nama: nama.trim() });
});

app.get("/api/queue/active/:nim", (req, res) => {
  const { nim } = req.params;
  const active = todaysQueues().find(
    (q) => q.nim === nim && (q.status === "menunggu" || q.status === "dipanggil")
  );
  if (!active) return res.json({ active: null });
  res.json({ active: withComputed(active) });
});

app.get("/api/queue/history/:nim", (req, res) => {
  const { nim } = req.params;
  const history = queues
    .filter((q) => q.nim === nim)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  res.json({ history });
});

app.post("/api/queue", apiLimiter, (req, res) => {
  const { nim, nama, layanan } = req.body || {};
  if (!nim || !nama || !layanan) {
    return res.status(400).json({ error: "NIM, Nama, dan Jenis Layanan wajib diisi." });
  }
  if (!/^[0-9]{5,15}$/.test(nim)) {
    return res.status(400).json({ error: "Format NIM tidak valid." });
  }
  if (!LAYANAN_LIST.includes(layanan)) {
    return res.status(400).json({ error: "Jenis layanan tidak valid." });
  }
  if (!isWithinOperationalHours()) {
    return res.status(403).json({
      error: `Pendaftaran ditolak. Klinik hanya menerima antrean pada jam ${settings.jamBuka} - ${settings.jamTutup}.`,
    });
  }
  const sudahAntre = todaysQueues().find(
    (q) => q.nim === nim && (q.status === "menunggu" || q.status === "dipanggil")
  );
  if (sudahAntre) {
    return res.status(409).json({ error: "Anda masih memiliki antrean aktif hari ini." });
  }
  if (todaysQueues().filter((q) => q.status !== "batal").length >= settings.kapasitasHarian) {
    return res.status(403).json({ error: "Kapasitas antrean hari ini sudah penuh." });
  }

  const nomorUrut = getNextNumber();
  const entry = {
    id: nextId++,
    nomorUrut,
    nomorLabel: "A" + String(nomorUrut).padStart(3, "0"),
    nim,
    nama: nama.trim(),
    layanan,
    status: "menunggu",
    createdAt: new Date().toISOString(),
    calledAt: null,
    completedAt: null,
    notified2: false,
  };
  queues.push(entry);
  notifLog.push({
    nim,
    message: `Pendaftaran berhasil. Nomor antrean Anda: ${entry.nomorLabel}.`,
    time: new Date().toISOString(),
  });

  recomputePositionsAndNotify();
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true, queue: withComputed(entry) });
});

app.post("/api/queue/:id/cancel", apiLimiter, (req, res) => {
  const entry = queues.find((q) => q.id === Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "Antrean tidak ditemukan." });
  if (entry.status !== "menunggu") {
    return res.status(400).json({ error: "Hanya antrean dengan status menunggu yang dapat dibatalkan." });
  }
  entry.status = "batal";
  recomputePositionsAndNotify();
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true });
});

app.get("/api/notifikasi/:nim", (req, res) => {
  const list = notifLog.filter((n) => n.nim === req.params.nim).slice(-20).reverse();
  res.json({ notifikasi: list });
});

// ============== ROUTES: PETUGAS ==============
app.post("/api/staff/login", apiLimiter, (req, res) => {
  const { password } = req.body || {};
  if (password === STAFF_PASSWORD) return res.json({ ok: true });
  res.status(401).json({ error: "Password salah." });
});

app.get("/api/queue", (req, res) => {
  res.json({ queues: todaysQueues().sort((a, b) => a.nomorUrut - b.nomorUrut) });
});

app.post("/api/queue/call-next", apiLimiter, (req, res) => {
  const waiting = waitingQueueSorted();
  if (waiting.length === 0) {
    return res.status(404).json({ error: "Tidak ada antrean yang menunggu." });
  }
  const next = waiting[0];
  next.status = "dipanggil";
  next.calledAt = new Date().toISOString();
  recomputePositionsAndNotify();
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true, queue: next });
});

app.post("/api/queue/:id/complete", apiLimiter, (req, res) => {
  const entry = queues.find((q) => q.id === Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "Antrean tidak ditemukan." });
  entry.status = "selesai";
  entry.completedAt = new Date().toISOString();
  recomputePositionsAndNotify();
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true });
});

app.post("/api/queue/:id/cancel-by-staff", apiLimiter, (req, res) => {
  const entry = queues.find((q) => q.id === Number(req.params.id));
  if (!entry) return res.status(404).json({ error: "Antrean tidak ditemukan." });
  entry.status = "batal";
  recomputePositionsAndNotify();
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true });
});

app.post("/api/settings", apiLimiter, (req, res) => {
  const { jamBuka, jamTutup, kapasitasHarian, durasiLayananMenit } = req.body || {};
  if (jamBuka && /^\d{2}:\d{2}$/.test(jamBuka)) settings.jamBuka = jamBuka;
  if (jamTutup && /^\d{2}:\d{2}$/.test(jamTutup)) settings.jamTutup = jamTutup;
  if (kapasitasHarian && Number(kapasitasHarian) > 0) settings.kapasitasHarian = Number(kapasitasHarian);
  if (durasiLayananMenit && Number(durasiLayananMenit) > 0)
    settings.durasiLayananMenit = Number(durasiLayananMenit);
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true, settings });
});

app.get("/api/stats", (req, res) => {
  const today = todaysQueues();
  const total = today.filter((q) => q.status !== "batal").length;
  const selesai = today.filter((q) => q.status === "selesai").length;
  const menunggu = today.filter((q) => q.status === "menunggu").length;
  const dipanggil = today.filter((q) => q.status === "dipanggil").length;
  const batal = today.filter((q) => q.status === "batal").length;

  const durasiSelesai = today
    .filter((q) => q.status === "selesai" && q.calledAt && q.completedAt)
    .map((q) => (new Date(q.completedAt) - new Date(q.calledAt)) / 60000);
  const rataRataLayanan =
    durasiSelesai.length > 0
      ? (durasiSelesai.reduce((a, b) => a + b, 0) / durasiSelesai.length).toFixed(1)
      : 0;

  const perLayanan = {};
  LAYANAN_LIST.forEach((l) => (perLayanan[l] = 0));
  today.forEach((q) => {
    if (q.status !== "batal") perLayanan[q.layanan] = (perLayanan[q.layanan] || 0) + 1;
  });

  res.json({ total, selesai, menunggu, dipanggil, batal, rataRataLayanan, perLayanan });
});

app.post("/api/admin/reset-today", apiLimiter, (req, res) => {
  const today = todayStr();
  queues = queues.filter((q) => q.createdAt.slice(0, 10) !== today);
  dailyCounter = { date: today, value: 0 };
  persist();
  broadcastQueueUpdate();
  res.json({ ok: true });
});

app.get("/api/display", (req, res) => {
  const today = todaysQueues();
  const sedangDilayani = today.filter((q) => q.status === "dipanggil");
  const berikutnya = waitingQueueSorted().slice(0, 5);
  res.json({ sedangDilayani, berikutnya });
});

// ============== 404 & ERROR HANDLER ==============
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

app.use((err, req, res, next) => {
  console.error("[error]", err);
  res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

// ============== SOCKET.IO ==============
io.on("connection", (socket) => {
  socket.on("join", (nim) => {
    if (nim && typeof nim === "string") socket.join(nim);
  });
});

// ============== START SERVER ==============
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server Klinik Kampus berjalan di port ${PORT}`);
  console.log(`Data disimpan di: ${db.DATA_FILE}`);
});

// Simpan data sebelum proses berhenti (mis. saat platform deploy melakukan redeploy)
function gracefulShutdown() {
  console.log("Menyimpan data sebelum keluar...");
  db.saveSync({ queues, notifLog, nextId, dailyCounter, settings });
  process.exit(0);
}
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
