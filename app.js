const API = "https://bananapuck-server.onrender.com/get_data";

let chart;

const safeRanges = {
  hr: [50, 100],
  temp: [97, 100.4],
  accel: [0, 9.8]
};

function statusClass(value, [min, max]) {
  if (value < min || value > max) return "danger";
  if (value < min + 2 || value > max - 2) return "warning";
  return "safe";
}

async function loadData() {
  const res = await fetch(API);
  const d = await res.json();

  // MAP
  const map = L.map("map").setView([d.gps.lat || 36.9741, d.gps.lon || -122.0308], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
  if (d.gps.lat && d.gps.lon) L.marker([d.gps.lat, d.gps.lon]).addTo(map);

  // ALERTS
  document.getElementById("alerts").innerHTML = d.alerts_active.length
    ? d.alerts_active.map(a => `
      <div class="alert">
        <strong>${a.title}</strong><br>
        ${a.message}
        <span class="close">✕</span>
      </div>`).join("")
    : "No active alerts";

  // VITALS
  document.getElementById("vitals").innerHTML = `
    <div class="card ${statusClass(d.hr, safeRanges.hr)}" onclick="openModal('Heart Rate', d.hr)">
      <b>Heart Rate</b><br>${d.hr} bpm
    </div>
    <div class="card safe" onclick="openModal('Respiration', d.breathing)">
      <b>Respiration</b><br>${d.breathing} /min
    </div>
    <div class="card ${statusClass(d.temp, safeRanges.temp)}" onclick="openModal('Temperature', d.temp)">
      <b>Temperature</b><br>${d.temp} °F
    </div>
  `;

  // MOTION
  document.getElementById("motion").innerHTML = `
    <div class="card ${statusClass(d.accel.z, safeRanges.accel)}" onclick="openModal('Acceleration', d.accel.z)">
      <b>Acceleration</b><br>Z: ${d.accel.z.toFixed(2)}
    </div>
    <div class="card safe" onclick="openModal('Gyroscope', d.gyro.z)">
      <b>Gyroscope</b><br>Z: ${d.gyro.z.toFixed(2)}
    </div>
  `;

  // ENVIRONMENT
  document.getElementById("environment").innerHTML = `
    <div class="card">
      <b>GPS</b><br>
      Lat: ${d.gps.lat ?? "--"}<br>
      Lon: ${d.gps.lon ?? "--"}
    </div>
    <div class="card ${d.water_submerged ? "danger" : "safe"}">
      <b>Water Submergence</b><br>${d.water_submerged ? "YES" : "NO"}
    </div>
    <div class="card safe">
      <b>Map Location</b><br>
      Upload step-by-step photos
    </div>
  `;
}

function openModal(title, value) {
  document.getElementById("modal").style.display = "flex";
  document.getElementById("modalTitle").innerText = title;

  const labels = Array.from({ length: 20 }, (_, i) => i);
  const data = labels.map(() => value + (Math.random() - 0.5));

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("chart"), {
    type: "line",
    data: { labels, datasets: [{ data, label: title }] }
  });

  document.getElementById("tableBody").innerHTML =
    data.map((v, i) => `<tr><td>${i}</td><td>${v.toFixed(2)}</td></tr>`).join("");
}

function closeModal() {
  document.getElementById("modal").style.display = "none";
}

loadData();
setInterval(loadData, 3000);
