const SERVER = "https://bananapuck-server.onrender.com/get_data";

let map, marker;

function initMap() {
  map = L.map("map").setView([36.9741, -122.0308], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19
  }).addTo(map);

  marker = L.marker([36.9741, -122.0308]).addTo(map);
}

async function fetchData() {
  const res = await fetch(SERVER);
  const d = await res.json();

  // Vitals
  set("hr", d.hr, " bpm");
  set("breathing", d.breathing, " breaths/min");
  set("temp", d.temp, " °F");
  set("ecg", d.ecg ?? "--");

  // Motion
  set("ax", d.accel?.x);
  set("ay", d.accel?.y);
  set("az", d.accel?.z);
  set("gx", d.gyro?.x);
  set("gy", d.gyro?.y);
  set("gz", d.gyro?.z);

  // Orientation
  if (d.orientation?.length === 3) {
    set("roll", d.orientation[0]);
    set("pitch", d.orientation[1]);
    set("yaw", d.orientation[2]);
  }

  // GPS
  if (d.gps?.lat && d.gps?.lon) {
    set("lat", d.gps.lat);
    set("lon", d.gps.lon);
    set("gps-acc", d.gps.accuracy + " m");
    marker.setLatLng([d.gps.lat, d.gps.lon]);
    map.setView([d.gps.lat, d.gps.lon]);
  }

  // Environment
  set("water", d.water_submerged ? "YES" : "NO");

  // Time
  set("lastUpdate", new Date(d.timestamp).toLocaleString());

  // Alerts
  renderAlerts(d.alerts_active || []);
}

function set(id, val, suffix = "") {
  document.getElementById(id).innerText =
    val !== undefined && val !== null ? val + suffix : "--";
}

function renderAlerts(alerts) {
  const box = document.getElementById("alerts-container");
  box.innerHTML = "";

  if (!alerts.length) {
    box.innerHTML = "<div class='alert ok'>No active alerts</div>";
    return;
  }

  alerts.forEach(a => {
    const div = document.createElement("div");
    div.className = "alert";
    div.innerText = a.message;
    box.appendChild(div);
  });
}

/* ===== MODALS ===== */

function openHistory(type) {
  document.getElementById("historyModal").classList.remove("hidden");
  document.getElementById("historyTitle").innerText =
    type.toUpperCase() + " History";
  // charts hook goes here next
}

function closeHistory() {
  document.getElementById("historyModal").classList.add("hidden");
}

function openMapping() {
  document.getElementById("mappingModal").classList.remove("hidden");
}

function closeMapping() {
  document.getElementById("mappingModal").classList.add("hidden");
}

/* ===== INIT ===== */

initMap();
fetchData();
setInterval(fetchData, 2000);
