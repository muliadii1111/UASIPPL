const API = "";
let socket = null;
let currentUser = JSON.parse(localStorage.getItem("klinik_user") || "null");

function showAlert(containerId, type, message) {
  document.getElementById(containerId).innerHTML = `<div class="alert ${type}">${message}</div>`;
  setTimeout(() => { const el = document.getElementById(containerId); if (el) el.innerHTML = ""; }, 5000);
}

async function login() {
  const nim = document.getElementById("nim").value.trim();
  const nama = document.getElementById("nama").value.trim();
  try {
    const res = await fetch(`${API}/api/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nim, nama }),
    });
    const data = await res.json();
    if (!res.ok) return showAlert("loginAlert", "error", data.error);
    currentUser = { nim, nama };
    localStorage.setItem("klinik_user", JSON.stringify(currentUser));
    initApp();
  } catch (e) { showAlert("loginAlert", "error", "Gagal terhubung ke server."); }
}

function logout() { localStorage.removeItem("klinik_user"); location.reload(); }

async function loadLayanan() {
  const res = await fetch(`${API}/api/layanan`);
  const data = await res.json();
  const sel = document.getElementById("layanan");
  sel.innerHTML = data.layanan.map((l) => `<option value="${l}">${l}</option>`).join("");
}

async function daftarAntrean() {
  const layanan = document.getElementById("layanan").value;
  try {
    const res = await fetch(`${API}/api/queue`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nim: currentUser.nim, nama: currentUser.nama, layanan }),
    });
    const data = await res.json();
    if (!res.ok) return showAlert("formAlert", "error", data.error);
    showAlert("formAlert", "success", `✅ Berhasil! Nomor antrean Anda: <strong>${data.queue.nomorLabel}</strong>`);
    await refreshActiveQueue();
  } catch (e) { showAlert("formAlert", "error", "Gagal terhubung ke server."); }
}

async function batalkanAntrean(id) {
  if (!confirm("Yakin ingin membatalkan antrean ini?")) return;
  await fetch(`${API}/api/queue/${id}/cancel`, { method: "POST" });
  await refreshActiveQueue();
}

function statusLabel(status) {
  const map = { menunggu: "Menunggu", dipanggil: "Sedang Dipanggil", selesai: "Selesai", batal: "Dibatalkan" };
  return `<span class="status-pill status-${status}">${map[status] || status}</span>`;
}

async function refreshActiveQueue() {
  const res = await fetch(`${API}/api/queue/active/${currentUser.nim}`);
  const data = await res.json();
  const card = document.getElementById("activeQueueCard");
  const content = document.getElementById("activeQueueContent");
  const formCard = document.getElementById("formCard");

  if (!data.active) {
    card.style.display = "none";
    formCard.style.display = "block";
    return;
  }

  formCard.style.display = "none";
  card.style.display = "block";
  const q = data.active;
  const isCalled = q.status === "dipanggil";
  const isDone = q.status === "selesai" || q.status === "batal";

  let metaHtml = "";
  if (q.status === "menunggu") {
    metaHtml = `<div class="qt-meta">
      <div class="qtm-item"><div class="qtm-val">${q.position}</div><div class="qtm-lbl">Di Depan Anda</div></div>
      <div class="qtm-item"><div class="qtm-val">~${q.estimasiMenit}</div><div class="qtm-lbl">Menit Lagi</div></div>
    </div>`;
  } else if (isCalled) {
    metaHtml = `<div class="called-banner">🔔 Silakan menuju klinik sekarang!</div>`;
  }

  content.innerHTML = `
    <div class="queue-ticket-wrap ${isCalled ? 'qt-called' : ''}">
      <div class="qt-label">Nomor Antrean Anda</div>
      <div class="queue-number">${q.nomorLabel}</div>
      <div class="qt-service">${q.layanan}</div>
      ${metaHtml}
      <hr class="qt-divider"/>
      <table class="qt-info-table">
        <tr><td>Status</td><td>${statusLabel(q.status)}</td></tr>
        <tr><td>Layanan</td><td>${q.layanan}</td></tr>
        <tr><td>Waktu Daftar</td><td>${new Date(q.createdAt).toLocaleString("id-ID")}</td></tr>
      </table>
      ${q.status === "menunggu" ? `<button class="qt-cancel-btn" onclick="batalkanAntrean(${q.id})">✕ Batalkan Antrean</button>` : ""}
    </div>`;
}

async function refreshHistory() {
  const res = await fetch(`${API}/api/queue/history/${currentUser.nim}`);
  const data = await res.json();
  const area = document.getElementById("historyArea");
  if (data.history.length === 0) {
    area.innerHTML = `<div class="empty-state"><div class="ei">📋</div><div class="et">Belum ada riwayat</div><div class="ed">Riwayat kunjungan Anda akan muncul di sini</div></div>`;
    return;
  }
  area.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Nomor</th><th>Layanan</th><th>Tanggal</th><th>Status</th></tr></thead>
    <tbody>
      ${data.history.map((h) => `<tr>
        <td><strong>${h.nomorLabel}</strong></td>
        <td>${h.layanan}</td>
        <td>${new Date(h.createdAt).toLocaleString("id-ID")}</td>
        <td>${statusLabel(h.status)}</td>
      </tr>`).join("")}
    </tbody>
  </table></div>`;
}

function showNotifToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `🔔 ${message}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

async function initApp() {
  document.getElementById("loginCard").style.display = "none";
  document.getElementById("appArea").style.display = "block";
  const badge = document.getElementById("userBadge");
  badge.style.display = "inline-block";
  badge.innerText = `${currentUser.nama} (${currentUser.nim})`;
  const sn = document.getElementById("sidebarUserName");
  const sni = document.getElementById("sidebarUserNim");
  if (sn) sn.textContent = currentUser.nama;
  if (sni) sni.textContent = currentUser.nim;

  await loadLayanan();
  await refreshActiveQueue();
  await refreshHistory();

  socket = io();
  socket.emit("join", currentUser.nim);
  socket.on("queue-updated", () => { refreshActiveQueue(); refreshHistory(); });
  socket.on("notifikasi", (data) => { showNotifToast(data.message); });
}

if (currentUser) initApp();
