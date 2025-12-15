const SERVER_BASE = "https://bananapuck-server.onrender.com";

// ---------------- DOM ----------------
const el = {
  hr: document.getElementById("heartRate"),
  respiration: document.getElementById("respirationRate"),
  temperature: document.getElementById("temperature"),
  water: document.getElementById("waterSub"),

  accelX: document.getElementById("accelX"),
  accelY: document.getElementById("accelY"),
  accelZ: document.getElementById("accelZ"),

  gyroX: document.getElementById("gyroX"),
  gyroY: document.getElementById("gyroY"),
  gyroZ: document.getElementById("gyroZ"),

  roll: document.getElementById("roll"),
  pitch: document.getElementById("pitch"),
  yaw: document.getElementById("yaw"),

  lat: document.getElementById("gpsLat"),
  lon: document.getElementById("gpsLon"),
  acc: document.getElementById("gpsAcc"),

  lastUpdate: document.getElementById("lastUpdate"),
};

// ---------------- MAP ----------------
const map = L.map("map").setView([37.42, -122.08], 16);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
const marker = L.marker([37.42, -122.08]).addTo(map);

// ---------------- FETCH LOOP ----------------
async function fetchData() {
  try {
    const res = await fetch(`${SERVER_BASE}/get_data`);
    const d = await res.json();
    console.log("Incoming data:", d);

    el.hr.textContent = d.hr ?? "--";
    el.respiration.textContent = d.breathing ?? "--";
    el.temperature.textContent = d.temp ?? "--";
    el.water.textContent = d.water_submerged ? "YES" : "NO";

    if (d.accel) {
      el.accelX.textContent = `X: ${d.accel.x.toFixed(2)}`;
      el.accelY.textContent = `Y: ${d.accel.y.toFixed(2)}`;
      el.accelZ.textContent = `Z: ${d.accel.z.toFixed(2)}`;
    }

    if (d.gyro) {
      el.gyroX.textContent = `X: ${d.gyro.x.toFixed(2)}`;
      el.gyroY.textContent = `Y: ${d.gyro.y.toFixed(2)}`;
      el.gyroZ.textContent = `Z: ${d.gyro.z.toFixed(2)}`;
    }

    if (Array.isArray(d.orientation)) {
      el.roll.textContent = d.orientation[0];
      el.pitch.textContent = d.orientation[1];
      el.yaw.textContent = d.orientation[2];
    }

    if (d.gps) {
      el.lat.textContent = d.gps.lat ?? "--";
      el.lon.textContent = d.gps.lon ?? "--";
      el.acc.textContent = d.gps.accuracy ?? "--";

      if (d.gps.lat && d.gps.lon) {
        marker.setLatLng([d.gps.lat, d.gps.lon]);
        map.setView([d.gps.lat, d.gps.lon]);
      }
    }

    el.lastUpdate.textContent = new Date().toLocaleString();
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

setInterval(fetchData, 1000);
fetchData();
