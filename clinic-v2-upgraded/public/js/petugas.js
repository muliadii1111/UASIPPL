const API = "";
let socket = null;
let isLoggedIn = sessionStorage.getItem("klinik_staff") === "1";

function showAlert(containerId, type, message) {
  document.getElementById(containerId).innerHTML = `<div class="alert ${type}">${message}</div>`;
  setTimeout(() => { const el = document.getElementById(containerId); if (el) el.innerHTML = ""; }, 5000);
}

async function staffLogin() {
  const password = document.getElementById("password").value;
  const res = await fetch(`${API}/api/staff/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!res.ok) return showAlert("loginAlert", "error", data.error);
  sessionStorage.setItem("klinik_staff", "1");
  // Hide the container holding the login card
  document.querySelector('.container').style.display = 'none';
  initDashboard();
}

function statusLabel(status) {
  const map = { menunggu: "Menunggu", dipanggil: "Sedang Dipanggil", selesai: "Selesai", batal: "Dibatalkan" };
  return `<span class="status-pill status-${status}">${map[status] || status}</span>`;
}

async function callNext() {
  const res = await fetch(`${API}/api/queue/call-next`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) return showAlert("callAlert", "error", data.error);
  showAlert("callAlert", "success", `📢 Memanggil nomor <strong>${data.queue.nomorLabel}</strong> — ${data.queue.nama}`);
  loadAll();
}

async function completeQueue(id) {
  await fetch(`${API}/api/queue/${id}/complete`, { method: "POST" }); loadAll();
}

async function cancelQueue(id) {
  if (!confirm("Batalkan antrean ini?")) return;
  await fetch(`${API}/api/queue/${id}/cancel-by-staff`, { method: "POST" }); loadAll();
}

async function resetToday() {
  if (!confirm("Ini akan menghapus seluruh data antrean hari ini. Lanjutkan?")) return;
  await fetch(`${API}/api/admin/reset-today`, { method: "POST" }); loadAll();
}

async function loadStats() {
  const res = await fetch(`${API}/api/stats`);
  const s = await res.json();
  document.getElementById("statGrid").innerHTML = `
    <div class="stat-box"><div class="sbi">📂</div><div class="num">${s.total}</div><div class="lbl">Total Hari Ini</div></div>
    <div class="stat-box"><div class="sbi">⏳</div><div class="num">${s.menunggu}</div><div class="lbl">Menunggu</div></div>
    <div class="stat-box"><div class="sbi">📢</div><div class="num">${s.dipanggil}</div><div class="lbl">Dipanggil</div></div>
    <div class="stat-box"><div class="sbi">✅</div><div class="num">${s.selesai}</div><div class="lbl">Selesai</div></div>
    <div class="stat-box"><div class="sbi">❌</div><div class="num">${s.batal}</div><div class="lbl">Dibatalkan</div></div>
    <div class="stat-box"><div class="sbi">⏱</div><div class="num">${s.rataRataLayanan}</div><div class="lbl">Rata² Menit</div></div>`;

  const badge = document.getElementById("navQueueBadge");
  if (badge) badge.textContent = s.menunggu;
}

async function loadQueueTable() {
  const res = await fetch(`${API}/api/queue`);
  const data = await res.json();
  const area = document.getElementById("queueTableArea");
  if (data.queues.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="ei">📋</div><div class="et">Belum ada antrean hari ini</div><div class="ed">Antrean akan muncul di sini setelah mahasiswa mendaftar</div></div>`;
    return;
  }
  area.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Nomor</th><th>Nama</th><th>NIM</th><th>Layanan</th><th>Status</th><th>Waktu</th><th>Aksi</th></tr></thead>
    <tbody>
      ${data.queues.map((q) => `<tr>
        <td><strong style="font-size:15px;color:var(--g800)">${q.nomorLabel}</strong></td>
        <td>${q.nama}</td>
        <td style="font-variant-numeric:tabular-nums;color:var(--n500)">${q.nim}</td>
        <td><span style="background:var(--g100);color:var(--g700);padding:3px 8px;border-radius:6px;font-size:12px;font-weight:600">${q.layanan}</span></td>
        <td>${statusLabel(q.status)}</td>
        <td style="color:var(--n500)">${new Date(q.createdAt).toLocaleTimeString("id-ID")}</td>
        <td>
          ${q.status === "dipanggil" ? `<button class="btn-sm" onclick="completeQueue(${q.id})">✅ Selesai</button>` : ""}
          ${q.status === "menunggu" ? `<button class="secondary btn-sm" onclick="cancelQueue(${q.id})">✕ Batal</button>` : ""}
        </td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}

async function loadSettingsForm() {
  const res = await fetch(`${API}/api/settings`);
  const s = await res.json();
  document.getElementById("jamBuka").value = s.jamBuka;
  document.getElementById("jamTutup").value = s.jamTutup;
  document.getElementById("kapasitas").value = s.kapasitasHarian;
  document.getElementById("durasi").value = s.durasiLayananMenit;
}

async function saveSettings() {
  const body = {
    jamBuka: document.getElementById("jamBuka").value,
    jamTutup: document.getElementById("jamTutup").value,
    kapasitasHarian: document.getElementById("kapasitas").value,
    durasiLayananMenit: document.getElementById("durasi").value,
  };
  await fetch(`${API}/api/settings`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  showAlert("settingsAlert", "success", "✅ Pengaturan berhasil disimpan.");
}

async function loadAll() { await Promise.all([loadStats(), loadQueueTable()]); }

function initDashboard() {
  document.getElementById("loginCard") && (document.getElementById("loginCard").style.display = "none");
  document.getElementById("dashboard").style.display = "block";
  loadAll();
  loadSettingsForm();
  socket = io();
  socket.on("queue-updated", () => { loadAll(); });
}

if (isLoggedIn) {
  document.addEventListener('DOMContentLoaded', () => {
    const c = document.querySelector('.container');
    if(c) c.style.display = 'none';
    initDashboard();
  });
}
