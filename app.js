const API = "https://bananapuck-server.onrender.com/get_data";

let historyData = { hr: [], breathing: [], temp: [] };
let alerts = [];
let chart;

/* MAP */
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
}

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
  if (historyData[key].length > 300) historyData[key].shift();
}

/* ALERTS */
function addAlert(msg) {
  alerts.push({
    msg,
    time: new Date(),
    acknowledged: false
  });
  renderAlerts();
}

function renderAlerts() {
  const container = document.getElementById("activeAlerts");
  container.innerHTML = "";

  // group unacknowledged alerts by message
  const grouped = {};
  alerts.forEach(a => {
    if (!a.acknowledged) {
      if (!grouped[a.msg]) grouped[a.msg] = [];
      grouped[a.msg].push(a.time);
    }
  });

  const messages = Object.keys(grouped);

  if (messages.length === 0) {
    container.innerHTML = "<em>No active alerts</em>";
    return;
  }

  messages.forEach(msg => {
    const timesHtml = grouped[msg]
      .map(t => t.toLocaleString())
      .join("<br>");

    container.innerHTML += `
      <div class="alert">
        <div class="alert-title">${msg}</div>
        <div class="alert-meta">${timesHtml}</div>
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
  renderAlerts();
}

/* Clear all active alerts */
function clearAllActiveAlerts() {
  alerts.forEach(a => {
    if (!a.acknowledged) a.acknowledged = true;
  });
  renderAlerts();
}

/* Tabs */
function showActiveAlerts() {
  document.getElementById("activeAlerts").style.display = "block";
  document.getElementById("alertHistory").style.display = "none";

  document.getElementById("activeTab").classList.add("active");
  document.getElementById("historyTab").classList.remove("active");

  // toggle controls
  document.getElementById("alertRange").style.display = "none";
  document.getElementById("clearAllBtn").style.display = "inline-block";
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

/* MODAL */
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

setInterval(fetchData, 2000);
fetchData();
