const API = "https://bananapuck-server.onrender.com/get_data";

let historyData = { hr: [], breathing: [], temp: [] };
let alerts = [];
let chart;
let currentSensorKey = null;
let currentSensorTitle = "";

const STORAGE_KEY = "bananapuck_data";
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const ALERTS_API = "https://bananapuck-server.onrender.com/alerts";
const ACK_API = "https://bananapuck-server.onrender.com/alerts/ack";


/* ---------- PERSISTENCE ---------- */
function saveData() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      historyData
    })
  );
}

function pruneOldData() {
  const cutoff = Date.now() - ONE_MONTH_MS;

  // prune alerts (kept as-is even though alerts come from server now)
  alerts = alerts.filter(a => new Date(a.time).getTime() > cutoff);

  // prune history
  Object.keys(historyData).forEach(k => {
    historyData[k] = historyData[k].filter(p => new Date(p.time).getTime() > cutoff);
  });

  saveData();
}

/* Load persisted data (ONCE) */
(function loadDataOnce() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return;

  try {
    const parsed = JSON.parse(stored);

    historyData = parsed.historyData || historyData;

    // restore Dates
    Object.keys(historyData).forEach(k => {
      historyData[k] = (historyData[k] || []).map(p => ({
        ...p,
        time: new Date(p.time)
      }));
    });

    pruneOldData();
  } catch (e) {
    console.warn("Failed to load stored data", e);
  }
})();

/* ---------- MAP ---------- */
const map = L.map("map").setView([36.9741, -122.0308], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
const marker = L.marker([36.9741, -122.0308]).addTo(map);

async function fetchData() {
  const res = await fetch(API);
  const data = await res.json();

  updateSensor("hr", data.hr, 60, 100, "bpm");
  updateSensor("breathing", data.breathing, 10, 20, "breaths/min");
  updateSensor("temp", data.temp, 97, 99.5, "°F");

  document.getElementById("accelValue").innerText =
    `X:${data.accel.x.toFixed(2)} Y:${data.accel.y.toFixed(2)} Z:${data.accel.z.toFixed(2)}`;

  document.getElementById("gyroValue").innerText =
    `X:${data.gyro.x.toFixed(2)} Y:${data.gyro.y.toFixed(2)} Z:${data.gyro.z.toFixed(2)}`;

  if (data.gps.lat !== null) {
    document.getElementById("gpsValue").innerText =
      `${data.gps.lat.toFixed(5)}, ${data.gps.lon.toFixed(5)} (±${data.gps.accuracy}m)`;
    marker.setLatLng([data.gps.lat, data.gps.lon]);
    map.setView([data.gps.lat, data.gps.lon], 15);
  }

  document.getElementById("waterValue").innerText =
    data.water_submerged ? "YES" : "NO";

  pruneOldData();
}

async function fetchAlerts() {
  const res = await fetch(ALERTS_API);
  alerts = (await res.json()).map(a => ({
    ...a,
    time: new Date(a.timestamp * 1000)
  }));
  renderAlerts();
}

async function ackAlertGroup(type) {
  await fetch(ACK_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type })
  });

  fetchAlerts();
}

/* ---------- SENSOR HISTORY ---------- */
function updateSensor(key, value, min, max, unit) {
  const card = document.getElementById(
    key === "hr" ? "hrCard" :
    key === "breathing" ? "brCard" : "tempCard"
  );

  card.classList.remove("safe", "warning", "danger");

  if (value < min - 5 || value > max + 5) {
    card.classList.add("danger");
  } else if (value < min || value > max) {
    card.classList.add("warning");
  } else {
    card.classList.add("safe");
  }

  document.getElementById(
    key === "hr" ? "hrValue" :
    key === "breathing" ? "brValue" : "tempValue"
  ).innerText = `${value.toFixed(1)} ${unit}`;

  historyData[key].push({ time: new Date(), value });
  if (historyData[key].length > 1000) historyData[key].shift();
  
  let lastSave = 0;

  function throttledSave() {
    const now = Date.now();
    if (now - lastSave > 15000) { // every 15 seconds
      saveData();
      lastSave = now;
    }
  }

  throttledSave();
}

document.addEventListener("click", e => {
  const closeBtn = e.target.closest(".close");
  if (!closeBtn) return;

  const msg = decodeURIComponent(closeBtn.dataset.msg);
  ackAlertGroup(msg);
});

/* ---------- ALERTS ---------- */
function renderAlerts() {
  const container = document.getElementById("activeAlerts");
  container.innerHTML = "";

  // group ONLY unacknowledged alerts in ACTIVE view
  const groups = {};
  alerts.forEach(a => {
    if (!a.acknowledged) {
      if (!groups[a.type]) groups[a.type] = [];
      groups[a.type].push(a);
    }
  });

  const keys = Object.keys(groups);

  if (keys.length === 0) {
    container.innerHTML = "<em>No active alerts</em>";
    return;
  }

  keys.forEach(type => {
    const group = groups[type];

    const title =
      type === "FALL"
      ? "Fall detected"
      : `${type} unsafe`;

    const now = Date.now();

    const times = group.map(a => {
      let line = a.time.toLocaleString();

      if (a.type === "FALL") {
        if (a.started_at) {
          const start = new Date(a.started_at).getTime();
          const seconds = Math.floor((now - start) / 1000);
          line += `<br>⏱️ Time fallen: ${seconds} seconds`;
        }

        if (a.coords) {
          line += `<br>📍 ${a.coords.lat.toFixed(5)}, ${a.coords.lon.toFixed(5)}`;
        }
      }

      return line;
    }).join("<br><br>");



    container.innerHTML += `
      <div class="alert">
        <div class="alert-title">${title}</div>
        <div class="alert-meta">${times}</div>
        <span class="close" data-msg="${encodeURIComponent(type)}">✕</span>
      </div>`;
  });
}

async function clearAllActiveAlerts() {
  const activeTypes = [...new Set(
    alerts.filter(a => !a.acknowledged).map(a => a.type)
  )];

  for (const type of activeTypes) {
    await fetch(ACK_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type })
    });
  }

  fetchAlerts();
}

/* History: NOT grouped, NOT clearable */
function renderAlertHistory() {
  const hours = document.getElementById("alertRange").value;
  const cutoff = new Date(Date.now() - hours * 3600000);
  const container = document.getElementById("alertHistory");

  container.innerHTML = "";

  const filtered = alerts
    .filter(a => a.time >= cutoff)
    .sort((a, b) => b.time - a.time);

  if (filtered.length === 0) {
    container.innerHTML = "<em>No alerts in this range</em>";
    return;
  }

  filtered.forEach(a => {
    container.innerHTML += `
      <div class="alert">
        <div class="alert-title">${a.message}</div>
        <div class="alert-meta">${a.time.toLocaleString()}</div>
      </div>`;
  });
}

function exportAlertsCSV() {
  const hours = document.getElementById("alertRange").value;
  const cutoff = Date.now() - hours * 3600000;

  const filtered = alerts
    .filter(a => a.time.getTime() >= cutoff)
    .sort((a, b) => a.time - b.time);

  if (filtered.length === 0) {
    alert("No alerts in the selected time range.");
    return;
  }

  let csv = "Alert Type,Value,Timestamp\n";

  filtered.forEach(a => {
    let value = "";
    if (a.message && a.message.includes(":")) {
      value = a.message.split(":").slice(1).join(":").trim();
    }
    csv += `"${a.type}","${value}","${a.time.toLocaleString()}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `bananapuck_alerts_last_${hours}_hours.csv`;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ---------- TABS ---------- */
function showActiveAlerts() {
  document.getElementById("activeAlerts").style.display = "block";
  document.getElementById("alertHistory").style.display = "none";

  document.getElementById("activeTab").classList.add("active");
  document.getElementById("historyTab").classList.remove("active");

  document.getElementById("alertRange").style.display = "none";
  document.getElementById("clearAllBtn").style.display = "inline-block";
  document.getElementById("exportCsvBtn").style.display = "none";

  renderAlerts();
}

function showHistoryAlerts() {
  document.getElementById("activeAlerts").style.display = "none";
  document.getElementById("alertHistory").style.display = "block";

  document.getElementById("activeTab").classList.remove("active");
  document.getElementById("historyTab").classList.add("active");

  document.getElementById("alertRange").style.display = "inline-block";
  document.getElementById("clearAllBtn").style.display = "none";
  document.getElementById("exportCsvBtn").style.display = "inline-block";

  renderAlertHistory();
}

/* ---------- MODAL (UPDATED) ---------- */
function openModal(title, key) {
  currentSensorKey = key;
  currentSensorTitle = title;

  document.getElementById("modal").style.display = "flex";
  document.getElementById("modalTitle").innerText = `${title} History`;

  // reset controls to defaults
  document.getElementById("sensorRange").value = "1"; // default: last 1 hour
  document.getElementById("exportSelect").value = "";

  updateSensorView();
}

function getFilteredSensorData() {
  const hours = parseFloat(document.getElementById("sensorRange").value);
  const cutoff = Date.now() - hours * 3600000;

  return historyData[currentSensorKey].filter(
    p => p.time.getTime() >= cutoff
  );
}

function updateSensorView() {
  if (document.getElementById("modal").style.display !== "flex") return;

  const data = getFilteredSensorData();

  const labels = data.map(p => p.time.toLocaleTimeString());
  const values = data.map(p => p.value);

  if (chart) chart.destroy();

  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: currentSensorTitle,
        data: values,
        borderWidth: 2,
        pointRadius: 1
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 45 } }
      }
    }
  });

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  data.forEach(p => {
    tbody.innerHTML += `
      <tr>
        <td>${p.time.toLocaleString()}</td>
        <td>${p.value.toFixed(2)}</td>
      </tr>`;
  });
}

function handleSensorExport() {
  const option = document.getElementById("exportSelect").value;

  if (option === "csv") exportSensorCSV();
  if (option === "pdf") exportSensorPDF();

  document.getElementById("exportSelect").value = "";
}

function exportSensorCSV() {
  const data = getFilteredSensorData();
  if (data.length === 0) {
    alert("No data in the selected time range.");
    return;
  }

  let csv = "Time,Value\n";
  data.forEach(p => {
    csv += `"${p.time.toLocaleString()}","${p.value}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `bananapuck_${currentSensorKey}_data.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

function exportSensorPDF() {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("jsPDF is not loaded. Add the jsPDF script tag to index.html.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("landscape");

  const rangeLabel = document.getElementById("sensorRange").selectedOptions[0].text;
  pdf.setFontSize(16);
  pdf.text(`${currentSensorTitle} (${rangeLabel})`, 10, 15);

  const canvas = document.getElementById("chart");
  const imgData = canvas.toDataURL("image/png", 1.0);

  pdf.addImage(imgData, "PNG", 10, 25, 270, 120);
  pdf.save(`bananapuck_${currentSensorKey}_graph.pdf`);
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

/* ---------- START ---------- */
setInterval(fetchData, 4000);
fetchData();
showActiveAlerts();
setInterval(fetchAlerts, 3000);
fetchAlerts();