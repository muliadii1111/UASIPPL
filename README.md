# Sistem Manajemen Antrean Klinik Kampus

Implementasi web sesuai Proposal **"Sistem Manajemen Antrean Klinik Kampus"** —
Muliadi (233510205), Teknik Informatika, Universitas Islam Riau.
Mata kuliah: Implementasi dan Pengujian Perangkat Lunak.

Versi ini sudah disiapkan untuk **production / deployment**: persistensi data,
environment variables, security middleware, health check endpoint, dan
konfigurasi deploy untuk beberapa platform populer.

---

## Daftar Isi
1. [Fitur](#fitur)
2. [Teknologi](#teknologi)
3. [Menjalankan di Lokal](#menjalankan-di-lokal)
4. [Menjalankan dengan Docker](#menjalankan-dengan-docker)
5. [Deploy ke Render.com (gratis, direkomendasikan)](#deploy-ke-rendercom)
6. [Deploy ke Railway.app](#deploy-ke-railwayapp)
7. [Deploy ke Fly.io](#deploy-ke-flyio)
8. [Deploy ke VPS sendiri](#deploy-ke-vps-sendiri)
9. [Environment Variables](#environment-variables)
10. [Struktur Folder](#struktur-folder)
11. [Pemetaan Kasus Uji Proposal](#pemetaan-kasus-uji-proposal)
12. [Catatan & Batasan](#catatan--batasan)

---

## Fitur

**Modul Mahasiswa** (`/mahasiswa.html`)
- Login menggunakan NIM + Nama
- Pendaftaran antrean daring (pilih jenis layanan)
- Pemantauan posisi antrean real-time (Socket.io / WebSocket)
- Estimasi waktu tunggu berdasarkan jumlah antrean di depan
- Notifikasi otomatis saat antrean tersisa 2 nomor
- Riwayat kunjungan & pembatalan antrean

**Modul Petugas Klinik** (`/petugas.html`)
- Login petugas (password via environment variable)
- Dashboard antrean real-time, panggil pasien berikutnya
- Tandai selesai / batal
- Atur jam operasional & kapasitas harian
- Statistik harian (total, selesai, menunggu, rata-rata waktu layanan)

**Papan Tampilan** (`/display.html`)
- Tampilan "sedang dilayani" & "antrean selanjutnya" untuk ruang tunggu fisik

**Kesiapan Produksi**
- Persistensi data ke file (`data/db.json`) — data tidak hilang saat restart
- Health check endpoint `/api/health` (dibutuhkan banyak platform PaaS)
- Rate limiting pada endpoint yang mengubah data
- Security header via Helmet
- Logging request via Morgan
- Graceful shutdown (data disimpan saat proses dihentikan)
- Konfigurasi siap pakai untuk Render, Railway, Fly.io, dan Docker

---

## Teknologi

| Komponen   | Teknologi                          |
|------------|--------------------------------------|
| Backend    | Node.js + Express                  |
| Real-time  | Socket.io (WebSocket)              |
| Frontend   | HTML, CSS, JavaScript (vanilla)    |
| Data       | File JSON persisten (`data/db.json`) |
| Security   | Helmet, express-rate-limit, CORS   |

---

## Menjalankan di Lokal

Prasyarat: Node.js 18+

```bash
npm install
cp .env.example .env     # lalu edit .env, terutama STAFF_PASSWORD
npm start
```

Buka:
- `http://localhost:3000` — halaman utama
- `http://localhost:3000/mahasiswa.html` — modul mahasiswa
- `http://localhost:3000/petugas.html` — modul petugas
- `http://localhost:3000/display.html` — papan tampilan

---

## Menjalankan dengan Docker

```bash
docker compose up --build
```

Atau manual:

```bash
docker build -t klinik-queue .
docker run -p 3000:3000 \
  -e STAFF_PASSWORD=ganti-password-ini \
  -v klinik_data:/app/data \
  klinik-queue
```

Volume `klinik_data` memastikan `data/db.json` tetap ada walau container
dihapus dan dibuat ulang.

---

## Deploy ke Render.com

Render menyediakan **persistent disk gratis terbatas** dan mendukung
WebSocket secara native — cocok untuk proyek ini.

1. Push folder project ini ke repository GitHub.
2. Buka [render.com](https://render.com) → **New** → **Web Service** →
   hubungkan repository.
3. Render akan otomatis mendeteksi `render.yaml` (Blueprint). Jika tidak,
   atur manual:
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Health Check Path:** `/api/health`
4. Tambahkan environment variable `STAFF_PASSWORD` dengan password pilihan Anda.
5. Tambahkan **Disk** (Persistent Disk) dengan mount path `/var/data`, lalu
   set environment variable `DATA_DIR=/var/data` (sudah ada di `render.yaml`).
6. Deploy. URL publik akan diberikan otomatis, contoh:
   `https://klinik-kampus-queue.onrender.com`

> Catatan: pada paket gratis Render, service akan "tidur" setelah idle dan
> butuh beberapa detik untuk bangun kembali saat diakses — wajar untuk
> proyek akademik/demo.

---

## Deploy ke Railway.app

1. Push project ke GitHub.
2. Di [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Railway otomatis membaca `Procfile` / `package.json` dan menjalankan `npm start`.
4. Di tab **Variables**, tambahkan `STAFF_PASSWORD`, `CORS_ORIGIN`, `NODE_ENV=production`.
5. Tambahkan **Volume** lalu mount ke `/app/data`, set `DATA_DIR=/app/data`.
6. Railway memberikan domain publik otomatis (bisa custom domain juga).

---

## Deploy ke Fly.io

```bash
fly launch --no-deploy        # pilih nama app, region terdekat (mis. Singapore)
fly volumes create klinik_data --size 1
```

Edit `fly.toml` hasil generate, tambahkan mount volume:
```toml
[mounts]
  source = "klinik_data"
  destination = "/app/data"

[env]
  DATA_DIR = "/app/data"
```

Set secret password lalu deploy:
```bash
fly secrets set STAFF_PASSWORD=ganti-password-ini
fly deploy
```

---

## Deploy ke VPS Sendiri

Cocok jika ingin kontrol penuh (mis. VPS kampus/pribadi).

```bash
git clone <repo-anda>
cd klinik-kampus-queue-system
npm install --omit=dev
cp .env.example .env   # edit sesuai kebutuhan
npm install -g pm2
pm2 start server.js --name klinik-queue
pm2 save
pm2 startup            # agar otomatis jalan saat server reboot
```

Lalu pasang reverse proxy Nginx (opsional, untuk HTTPS & domain sendiri):

```nginx
server {
    listen 80;
    server_name klinik.contoh-domain.ac.id;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

Gunakan `certbot` untuk HTTPS gratis (Let's Encrypt) setelah domain mengarah ke VPS.

---

## Environment Variables

| Variabel          | Default        | Keterangan |
|-------------------|----------------|------------|
| `PORT`            | `3000`         | Port server (biasanya di-override otomatis oleh platform PaaS) |
| `STAFF_PASSWORD`  | `klinik123`    | **Wajib diganti** sebelum deploy ke publik |
| `CORS_ORIGIN`     | `*`            | Gunakan domain spesifik di produksi |
| `DATA_DIR`        | `./data`       | Lokasi file persistensi; arahkan ke volume/disk platform deploy |
| `NODE_ENV`        | `development`  | Set `production` di server live |

---

## Struktur Folder

```
.
├── server.js              # Logika backend (API + Socket.io)
├── db.js                   # Lapisan persistensi (file JSON)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── render.yaml             # Blueprint deploy Render.com
├── Procfile                # Untuk Railway/Heroku-style platform
├── .env.example
└── public/
     ├── index.html         # Landing page
     ├── mahasiswa.html     # Modul mahasiswa
     ├── petugas.html       # Modul petugas
     ├── display.html       # Papan tampilan
     ├── css/style.css
     └── js/
          ├── mahasiswa.js
          └── petugas.js
```

---

## Pemetaan Kasus Uji Proposal (Bab IV.3)

| ID    | Skenario                          | Status |
|-------|------------------------------------|--------|
| TC-01 | Pendaftaran antrean berhasil       | ✅ |
| TC-02 | Login dengan NIM tidak terdaftar   | ✅ Validasi format NIM |
| TC-03 | Pembaruan antrean real-time        | ✅ Via Socket.io |
| TC-04 | Notifikasi H-2 antrean             | ✅ |
| TC-05 | Pendaftaran di luar jam layanan    | ✅ |
| TC-06 | Kapasitas harian penuh             | ✅ |
| TC-07 | Petugas memperbarui status pasien  | ✅ |

---

## Catatan & Batasan

- **Database:** Proyek ini menggunakan file JSON sebagai penyimpanan agar
  bisa langsung di-deploy tanpa provisioning database server terpisah.
  Untuk skala lebih besar / multi-instance, ganti `db.js` dengan koneksi
  MySQL/PostgreSQL sesuai rencana teknologi pada proposal — logika bisnis
  di `server.js` tidak perlu diubah, cukup ganti cara baca/tulis state.
- **Notifikasi WhatsApp/SMS:** Pada proposal asli direncanakan memakai
  WhatsApp Gateway/Twilio (berbayar). Implementasi ini menyimulasikan
  notifikasi melalui event real-time di dalam aplikasi (toast + log),
  sehingga dapat didemonstrasikan tanpa biaya API pihak ketiga. Untuk
  notifikasi WhatsApp/SMS sungguhan, tambahkan panggilan API Twilio/WhatsApp
  Business pada fungsi `recomputePositionsAndNotify()` di `server.js`.
- **Skalabilitas:** Karena state disimpan di memori + file lokal, proyek
  ini cocok untuk single-instance deployment (umum untuk skala klinik
  kampus). Untuk multi-instance/load balancing, perlu database eksternal
  bersama dan Socket.io adapter (mis. Redis adapter).

## Pengembangan Lanjutan (sesuai Bab VI.2 Proposal)

- Integrasi database MySQL/PostgreSQL
- Integrasi WhatsApp Gateway/Twilio untuk notifikasi nyata
- Sinkronisasi data mahasiswa dengan Sistem Informasi Akademik kampus
- Aplikasi mobile native
- Analitik prediktif kepadatan antrean berbasis data historis
