const API = "https://bananapuck-server.onrender.com/get_data";

let historyData = { hr: [], breathing: [], temp: [] };
let alerts = [];
let chart;

const STORAGE_KEY = "bananapuck_data";
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/* ---------- PERSISTENCE ---------- */
function saveData() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      historyData,
      alerts
    })
  );
}

function pruneOldData() {
  const cutoff = Date.now() - ONE_MONTH_MS;

  // prune alerts
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

    alerts = (parsed.alerts || []).map(a => ({
      ...a,
      time: new Date(a.time)
    }));

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

/* ---------- SENSOR HISTORY ---------- */
function updateSensor(key, value, min, max, unit) {
  const card = document.getElementById(
    key === "hr" ? "hrCard" :
    key === "breathing" ? "brCard" : "tempCard"
  );

  card.classList.remove("safe", "warning", "danger");

  if (value < min - 5 || value > max + 5) {
    card.classList.add("danger");
    addAlert(`${key.toUpperCase()} unsafe: ${value.toFixed(1)} ${unit}`);
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
  if (historyData[key].length > 3000) historyData[key].shift(); // optional: larger buffer
  saveData();
}

/* ---------- ALERTS ---------- */
function addAlert(msg) {
  alerts.push({
    msg,
    time: new Date(),
    acknowledged: false
  });

  saveData();
  renderAlerts();
}

function renderAlerts() {
  const container = document.getElementById("activeAlerts");
  container.innerHTML = "";

  // group ONLY unacknowledged alerts in ACTIVE view
  const groups = {};
  alerts.forEach(a => {
    if (!a.acknowledged) {
      if (!groups[a.msg]) groups[a.msg] = [];
      groups[a.msg].push(a);
    }
  });

  const keys = Object.keys(groups);

  if (keys.length === 0) {
    container.innerHTML = "<em>No active alerts</em>";
    return;
  }

  keys.forEach(msg => {
    const times = groups[msg]
      .map(a => a.time.toLocaleString())
      .join("<br>");

    container.innerHTML += `
      <div class="alert">
        <div class="alert-title">${msg}</div>
        <div class="alert-meta">${times}</div>
        <span class="close" onclick="ackAlertGroup(${JSON.stringify(msg)})">✕</span>
      </div>`;
  });
}

function ackAlertGroup(msg) {
  alerts.forEach(a => {
    if (a.msg === msg && !a.acknowledged) {
      a.acknowledged = true;
    }
  });

  saveData();
  renderAlerts();
}

function clearAllActiveAlerts() {
  alerts.forEach(a => {
    if (!a.acknowledged) a.acknowledged = true;
  });

  saveData();
  renderAlerts();
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
        <div class="alert-title">${a.msg}</div>
        <div class="alert-meta">${a.time.toLocaleString()}</div>
      </div>`;
  });
}

/* ---------- TABS ---------- */
function showActiveAlerts() {
  document.getElementById("activeAlerts").style.display = "block";
  document.getElementById("alertHistory").style.display = "none";

  document.getElementById("activeTab").classList.add("active");
  document.getElementById("historyTab").classList.remove("active");

  // toggle controls
  document.getElementById("alertRange").style.display = "none";
  document.getElementById("clearAllBtn").style.display = "inline-block";

  renderAlerts();
}

function showHistoryAlerts() {
  document.getElementById("activeAlerts").style.display = "none";
  document.getElementById("alertHistory").style.display = "block";

  document.getElementById("activeTab").classList.remove("active");
  document.getElementById("historyTab").classList.add("active");

  // toggle controls
  document.getElementById("alertRange").style.display = "inline-block";
  document.getElementById("clearAllBtn").style.display = "none";

  renderAlertHistory();
}

/* ---------- MODAL ---------- */
function openModal(title, key) {
  document.getElementById("modal").style.display = "flex";
  document.getElementById("modalTitle").innerText = `${title} History`;

  const labels = historyData[key].map(p => p.time.toLocaleTimeString());
  const values = historyData[key].map(p => p.value);

  if (chart) chart.destroy();

  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: {
      labels,
      datasets: [{ label: title, data: values }]
    }
  });

  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";
  historyData[key].forEach(p => {
    tbody.innerHTML += `<tr><td>${p.time.toLocaleTimeString()}</td><td>${p.value.toFixed(2)}</td></tr>`;
  });
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

/* ---------- START ---------- */
setInterval(fetchData, 2000);
fetchData();
showActiveAlerts();
