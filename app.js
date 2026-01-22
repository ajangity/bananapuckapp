const API = "https://bananapuck-server.onrender.com/get_data";

let historyData = { hr: [], breathing: [], temp: [], co: [] };
let alerts = [];
let chart;
let currentSensorKey = null;
let currentSensorTitle = "";

const STORAGE_KEY = "bananapuck_data";
const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const ALERTS_API = "https://bananapuck-server.onrender.com/alerts";
const ACK_API = "https://bananapuck-server.onrender.com/alerts/ack";

const SETTINGS_KEY = "bananapuck_settings";
const SAFE_PATHS_KEY = "bananapuck_safe_paths";

let refreshIntervalMs = 4000; // default: 4s
let dataIntervalId = null;
let alertsIntervalId = null;

// Safe paths management
let safePaths = [];
let drawControl = null;
let currentDrawingLayer = null;
let isDrawing = false;
let drawHandler = null;

function applyRefreshIntervals() {
  if (dataIntervalId) clearInterval(dataIntervalId);
  if (alertsIntervalId) clearInterval(alertsIntervalId);

  dataIntervalId = setInterval(fetchData, refreshIntervalMs);
  alertsIntervalId = setInterval(fetchAlerts, 3000);
}


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

function loadSettings() {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (!stored) return;

  try {
    const settings = JSON.parse(stored);
    if (settings.refreshIntervalMs) {
      refreshIntervalMs = settings.refreshIntervalMs;
    }
  } catch {
    console.warn("Failed to load settings");
  }
}

function goToSettings() {
  window.location.href = "settings.html";
}

/* ---------- MAP ---------- */
const map = L.map("map").setView([36.9741, -122.0308], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
const marker = L.marker([36.9741, -122.0308]).addTo(map);

// Layer group for safe paths
const safePathsLayerGroup = L.layerGroup().addTo(map);

/* ---------- SAFE PATHS ---------- */
function loadSafePaths() {
  const stored = localStorage.getItem(SAFE_PATHS_KEY);
  if (!stored) {
    safePaths = [];
    return;
  }

  try {
    safePaths = JSON.parse(stored);
    renderSafePaths();
  } catch (e) {
    console.warn("Failed to load safe paths", e);
    safePaths = [];
  }
}

function saveSafePaths() {
  localStorage.setItem(SAFE_PATHS_KEY, JSON.stringify(safePaths));
}

function renderSafePaths() {
  safePathsLayerGroup.clearLayers();

  safePaths.forEach((path, index) => {
    if (path.coordinates && path.coordinates.length > 0) {
      const polyline = L.polyline(path.coordinates, {
        color: "#2ecc71",
        weight: 5,
        opacity: 0.8,
        dashArray: "10, 5"
      }).addTo(safePathsLayerGroup);

      // Add popup with path name
      polyline.bindPopup(`<strong>${path.name || `Path ${index + 1}`}</strong><br><button onclick="deleteSafePath(${index})" style="margin-top: 5px; padding: 4px 8px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>`);
    }
  });
}

function openSafePathsModal() {
  document.getElementById("safePathsModal").style.display = "flex";
  renderSavedPathsList();
}

function closeSafePathsModal() {
  document.getElementById("safePathsModal").style.display = "none";
  stopDrawingPath();
}

function startDrawingPath() {
  if (isDrawing) return;

  isDrawing = true;
  document.getElementById("startDrawingBtn").style.display = "none";
  document.getElementById("stopDrawingBtn").style.display = "inline-block";
  document.getElementById("savePathBtn").style.display = "none";
  document.getElementById("pathNameInput").style.display = "none";
  document.getElementById("drawingInstruction").style.display = "block";

  // Minimize the modal so map is visible
  const modal = document.getElementById("safePathsModal");
  modal.classList.add("minimized");

  // Initialize Leaflet Draw for polyline only
  drawControl = new L.Control.Draw({
    draw: {
      polyline: {
        shapeOptions: {
          color: "#2ecc71",
          weight: 5
        },
        metric: true
      },
      polygon: false,
      rectangle: false,
      circle: false,
      marker: false,
      circlemarker: false
    },
    edit: false
  });

  map.addControl(drawControl);

  // Handle when drawing is created
  const onCreated = function(e) {
    const layer = e.layer;
    currentDrawingLayer = layer;
    
    // Store the drawing temporarily on map (not in safePathsLayerGroup yet)
    layer.addTo(map);
    
    // Show save button and name input
    document.getElementById("savePathBtn").style.display = "inline-block";
    document.getElementById("pathNameInput").style.display = "block";
    
    // Remove draw control
    if (drawControl) {
      map.removeControl(drawControl);
      drawControl = null;
    }
    
    // Remove event listener
    map.off(L.Draw.Event.CREATED, onCreated);
    map.off(L.Draw.Event.DRAWSTOP, onDrawStop);
    
    isDrawing = false;
    document.getElementById("startDrawingBtn").style.display = "inline-block";
    document.getElementById("stopDrawingBtn").style.display = "none";
    
    // Restore modal size
    const modal = document.getElementById("safePathsModal");
    modal.classList.remove("minimized");
    document.getElementById("drawingInstruction").style.display = "none";
  };

  // Handle when drawing is cancelled/stopped
  const onDrawStop = function() {
    if (currentDrawingLayer) {
      map.removeLayer(currentDrawingLayer);
      currentDrawingLayer = null;
    }
    document.getElementById("savePathBtn").style.display = "none";
    document.getElementById("pathNameInput").style.display = "none";
    
    if (drawControl) {
      map.removeControl(drawControl);
      drawControl = null;
    }
    
    map.off(L.Draw.Event.CREATED, onCreated);
    map.off(L.Draw.Event.DRAWSTOP, onDrawStop);
    
    isDrawing = false;
    document.getElementById("startDrawingBtn").style.display = "inline-block";
    document.getElementById("stopDrawingBtn").style.display = "none";
    document.getElementById("drawingInstruction").style.display = "none";
    
    // Restore modal size
    const modal = document.getElementById("safePathsModal");
    modal.classList.remove("minimized");
  };

  map.on(L.Draw.Event.CREATED, onCreated);
  map.on(L.Draw.Event.DRAWSTOP, onDrawStop);
}

function stopDrawingPath() {
  if (currentDrawingLayer) {
    map.removeLayer(currentDrawingLayer);
    currentDrawingLayer = null;
  }
  
  // Remove draw control if it exists
  if (drawControl) {
    map.removeControl(drawControl);
    drawControl = null;
  }

  // Clear all draw event listeners
  map.off(L.Draw.Event.CREATED);
  map.off(L.Draw.Event.DRAWSTOP);
  map.off(L.Draw.Event.DRAWSTART);

  isDrawing = false;
  document.getElementById("startDrawingBtn").style.display = "inline-block";
  document.getElementById("stopDrawingBtn").style.display = "none";
  document.getElementById("savePathBtn").style.display = "none";
  document.getElementById("pathNameInput").style.display = "none";
  document.getElementById("drawingInstruction").style.display = "none";
  
  // Restore modal size
  const modal = document.getElementById("safePathsModal");
  modal.classList.remove("minimized");
}

function saveCurrentPath() {
  if (!currentDrawingLayer) {
    alert("No path to save. Please draw a path first.");
    return;
  }

  const pathName = document.getElementById("pathNameField").value.trim() || `Path ${safePaths.length + 1}`;
  const latlngs = currentDrawingLayer.getLatLngs();
  
  // Convert LatLng objects to simple coordinate arrays
  const coordinates = latlngs.map(ll => [ll.lat, ll.lng]);

  if (coordinates.length < 2) {
    alert("Path must have at least 2 points.");
    return;
  }

  // Add to safe paths
  safePaths.push({
    name: pathName,
    coordinates: coordinates,
    createdAt: new Date().toISOString()
  });

  saveSafePaths();
  renderSafePaths();
  renderSavedPathsList();

  // Clean up
  map.removeLayer(currentDrawingLayer);
  currentDrawingLayer = null;
  document.getElementById("pathNameField").value = "";
  document.getElementById("savePathBtn").style.display = "none";
  document.getElementById("pathNameInput").style.display = "none";
  document.getElementById("drawingInstruction").style.display = "none";
  
  // Restore modal size
  const modal = document.getElementById("safePathsModal");
  modal.classList.remove("minimized");
}

function deleteSafePath(index) {
  if (confirm(`Are you sure you want to delete "${safePaths[index].name}"?`)) {
    safePaths.splice(index, 1);
    saveSafePaths();
    renderSafePaths();
    renderSavedPathsList();
  }
}

function renderSavedPathsList() {
  const container = document.getElementById("savedPathsList");
  container.innerHTML = "";

  if (safePaths.length === 0) {
    container.innerHTML = "<p style='color: #999; font-style: italic;'>No safe paths saved yet. Click 'Start Drawing' to create your first path.</p>";
    return;
  }

  safePaths.forEach((path, index) => {
    const pathItem = document.createElement("div");
    pathItem.style.cssText = "padding: 12px; margin-bottom: 10px; background: #f5f5f5; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;";
    
    pathItem.innerHTML = `
      <div>
        <strong>${path.name}</strong>
        <div style="font-size: 12px; color: #666; margin-top: 4px;">
          ${path.coordinates.length} points • Created: ${new Date(path.createdAt).toLocaleDateString()}
        </div>
      </div>
      <button onclick="deleteSafePath(${index})" style="padding: 6px 12px; background: #e74c3c; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px;">
        Delete
      </button>
    `;
    
    container.appendChild(pathItem);
  });
}

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

  const waterCard = document.getElementById("waterCard");
  const waterValue = document.getElementById("waterValue");

  if (data.water_submerged) {
    waterValue.innerText = "SUBMERGED";
    waterCard.classList.remove("safe");
    waterCard.classList.add("danger");
  } else {
    waterValue.innerText = "DRY";
    waterCard.classList.remove("danger");
    waterCard.classList.add("safe");
  }

  /* ---------- CO (ppm) ---------- */
  if (data.co_ppm !== undefined && data.co_ppm !== null) {
    updateCO(data.co_ppm);
  } else {
    document.getElementById("coValue").innerText = "-- ppm";
    const card = document.getElementById("coCard");
    if (card) card.classList.remove("safe", "warning", "danger");
  }

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

function updateCO(ppm) {
  const card = document.getElementById("coCard");
  if (!card) return;

  card.classList.remove("safe", "warning", "danger");

  // Simple thresholds (ppm)
  // 0–9: safe, 10–35: warning, >35: danger
  if (ppm > 35) {
    card.classList.add("danger");
  } else if (ppm >= 10) {
    card.classList.add("warning");
  } else {
    card.classList.add("safe");
  }

  document.getElementById("coValue").innerText = `${ppm.toFixed(1)} ppm`;

  // store history for modal + exports
  historyData.co.push({ time: new Date(), value: ppm });
  if (historyData.co.length > 1000) historyData.co.shift();

  // keep your existing save strategy
  // (don’t spam saves on every sample if your throttling exists elsewhere)
  saveData();
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
          const start = a.started_at * 1000;
          const seconds = Math.max(0, Math.floor((now - start) / 1000));
          line += `<br>⏱️ Time fallen: ${seconds} seconds`;
        }

        if (a.coords) {
          line += `<br>📍 ${a.coords.lat.toFixed(5)}, ${a.coords.lon.toFixed(5)}`;
        }
      }

      // 🔥 WATER SUBMERGENCE (ADDED)
      if (a.type === "WATER") {
        if (a.started_at) {
          const start = a.started_at * 1000;
          const seconds = Math.max(0, Math.floor((now - start) / 1000));
          line += `<br>⏱️ Time submerged: ${seconds} seconds`;
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

function loadSettings() {
  const stored = localStorage.getItem(SETTINGS_KEY);
  if (!stored) return;

  try {
    const settings = JSON.parse(stored);
    if (settings.refreshIntervalMs) {
      refreshIntervalMs = settings.refreshIntervalMs;
    }
  } catch {
    console.warn("Failed to load settings");
  }
}

function applyRefreshIntervals() {
  // clear old intervals if they exist
  if (dataIntervalId) clearInterval(dataIntervalId);
  if (alertsIntervalId) clearInterval(alertsIntervalId);

  // start new intervals using current settings
  dataIntervalId = setInterval(fetchData, refreshIntervalMs);
  alertsIntervalId = setInterval(fetchAlerts, 3000); // alerts can stay fixed
}


/* ---------- START ---------- */
loadSettings();
loadSafePaths();
applyRefreshIntervals();

fetchData();
fetchAlerts();
showActiveAlerts();
