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

let drawingMap = null;

let drawingMapInitialized = false;

let currentPathPoints = [];

let currentPathPolyline = null;

let isDrawing = false;



// Current status and sensor values

let currentStatus = "unknown";

let confirmedActivity = "unknown"; // Activity that's been stable long enough

let lastActivityChangeTime = Date.now();

let activityConfirmationCount = 0;

  if (safePathsLayerGroup) {
    safePathsLayerGroup.clearLayers();

    safePaths.forEach((path, index) => {
      if (path.coordinates && path.coordinates.length > 0) {
        const polyline = L.polyline(path.coordinates, {
          color: "#2ecc71",
          weight: 5,
          opacity: 0.8,
          dashArray: "10, 5"
        }).addTo(safePathsLayerGroup);

        polyline.bindPopup(`<strong>${path.name || `Path ${index + 1}`}</strong><br><button onclick="deleteSafePath(${index})" style="margin-top: 5px; padding: 4px 8px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Delete</button>`);
      }
    });
  }

  // Also render on drawing map if it exists
  if (drawingMap) {
    // Clear existing path layers (but keep markers)
    drawingMap.eachLayer(function(layer) {
      if (layer instanceof L.Polyline && layer !== currentPathPolyline) {
        drawingMap.removeLayer(layer);
      }
    });

    // Add saved paths to drawing map
    safePaths.forEach((path, index) => {
      if (path.coordinates && path.coordinates.length > 0) {
        const polyline = L.polyline(path.coordinates, {
          color: "#2ecc71",
          weight: 4,
          opacity: 0.6,
          dashArray: "10, 5"
        }).addTo(drawingMap);

        polyline.bindPopup(`<strong>${path.name || `Path ${index + 1}`}</strong>`);
      }
    });
  }
    // High movement

    if (hr > 110) {

      return "running";

    } else if (hr > 90) {

      return "exercising";

    }

    return "walking";

  } else if (accelMag > 1.5 && hr > 75 && breathing > 18) {

    // Moderate movement with elevated vitals

    return "exercising";

  } else if (accelMag > 0.8) {

    return "walking";

  } else if (hr > 110) {

    return "exercising";

  } else if (hr > 85 && breathing > 18) {

    // Could be exercising, showering, or active

    if (accelMag > 0.5) return "exercising";

    return "showering";

  }

  

  return "resting";

}



/* ---------- CONTEXT-AWARE THRESHOLDS ---------- */

function getSafeRanges(activity) {

  const ranges = {

    sleeping: { hr: { min: 40, max: 65 }, breathing: { min: 8, max: 20 }, temp: { min: 96.5, max: 98.5 } },

    resting: { hr: { min: 55, max: 80 }, breathing: { min: 12, max: 22 }, temp: { min: 97, max: 99 } },

    walking: { hr: { min: 75, max: 110 }, breathing: { min: 16, max: 30 }, temp: { min: 97, max: 100 } },

    exercising: { hr: { min: 90, max: 130 }, breathing: { min: 22, max: 38 }, temp: { min: 97, max: 101 } },

    running: { hr: { min: 120, max: 150 }, breathing: { min: 30, max: 42 }, temp: { min: 97.5, max: 101.5 } },

    showering: { hr: { min: 75, max: 100 }, breathing: { min: 14, max: 24 }, temp: { min: 97.5, max: 100.5 } }

  };

  

  return ranges[activity] || ranges.resting;

}



/* ---------- ACTIVITY STABILITY & CONFIRMATION ---------- */

function updateActivityStatus(detectedActivity) {

  // Check if detected activity matches current confirmed activity

  if (detectedActivity === confirmedActivity) {

    // Same activity, reset confirmation counter

    activityConfirmationCount = 0;

    return; // Don't change anything

  }



  // Different activity detected - increment confirmation counter

  activityConfirmationCount++;



  // Require multiple confirmations before changing activity

  if (activityConfirmationCount < requiredConfirmations) {

    return; // Not enough confirmations yet

  }



  // Check if enough time has passed since last activity change

  const timeSinceLastChange = Date.now() - lastActivityChangeTime;

  const minDurationForLastActivity = ACTIVITY_MIN_DURATIONS[confirmedActivity] || 5 * 60 * 1000;



  if (timeSinceLastChange < minDurationForLastActivity) {

    // Not enough time has passed - keep current activity

    activityConfirmationCount = 0; // Reset counter

    return;

  }



  // Enough confirmations AND enough time has passed - change activity

  confirmedActivity = detectedActivity;

  lastActivityChangeTime = Date.now();

  activityConfirmationCount = 0;

}







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

  // Previously opened a modal on index; now navigate to the settings page section
  window.location.href = 'settings.html#safe-paths';

}



function closeSafePathsModal() {

  // modal removed — no-op

}
// Main map, marker and layer group (initialized on page load)
let map = null;
let marker = null;
let safePathsLayerGroup = null;



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

  // Initialize the main map displayed on the dashboard (index.html)
  function initializeMainMap() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    // Default view
    const initialLat = 36.9741;
    const initialLon = -122.0308;

    // Create map
    try {
      map = L.map('map', { center: [initialLat, initialLon], zoom: 13 });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      // create marker placeholder
      marker = L.marker([initialLat, initialLon], { draggable: false }).addTo(map);

      // Layer group for safe paths on main map
      safePathsLayerGroup = L.layerGroup().addTo(map);

      // Render any saved safe paths onto the main map
      if (typeof renderSafePaths === 'function') renderSafePaths();
    } catch (e) {
      console.warn('Main map init failed', e);
    }
  }



function saveSafePaths() {

  localStorage.setItem(SAFE_PATHS_KEY, JSON.stringify(safePaths));

}



function renderSafePaths() {

  // Render on main map

  if (safePathsLayerGroup) safePathsLayerGroup.clearLayers();



  safePaths.forEach((path, index) => {

    if (path.coordinates && path.coordinates.length > 0) {

      if (safePathsLayerGroup) {
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

  

  // Also render on drawing map if it exists

  if (drawingMap) {

    // Clear existing path layers (but keep markers)

    drawingMap.eachLayer(function(layer) {

      if (layer instanceof L.Polyline && layer !== currentPathPolyline) {

        drawingMap.removeLayer(layer);

      }

    });

    

    // Add saved paths to drawing map

    safePaths.forEach((path, index) => {

      if (path.coordinates && path.coordinates.length > 0) {

        const polyline = L.polyline(path.coordinates, {

          color: "#2ecc71",

          weight: 4,

          opacity: 0.6,

          dashArray: "10, 5"

        }).addTo(drawingMap);

        

        polyline.bindPopup(`<strong>${path.name || `Path ${index + 1}`}</strong>`);

      }

    });

  }

}



function openSafePathsModal() {

  window.location.href = 'settings.html#safe-paths';
  return;

  

  // Initialize drawing map if not already done

  if (!drawingMapInitialized) {

    initializeDrawingMap();

    drawingMapInitialized = true;

  }

  

  // Center map on current GPS location if available, otherwise default location

  if (marker && marker.getLatLng()) {

    const currentPos = marker.getLatLng();

    drawingMap.setView([currentPos.lat, currentPos.lng], 16);

  } else {

    drawingMap.setView([36.9741, -122.0308], 16);

  }

  

  renderSavedPathsList();

  stopDrawingPath(); // Reset any drawing state

}



function closeSafePathsModal() {

  // modal removed — no-op

}



function initializeDrawingMap() {

  // Create a new map instance in the modal

  const mapContainer = document.getElementById("drawingMap");

  

  // Get current position or use default

  let initialLat = 36.9741;

  let initialLon = -122.0308;

  let initialZoom = 16;

  

  if (marker && marker.getLatLng()) {

    const pos = marker.getLatLng();

    initialLat = pos.lat;

    initialLon = pos.lng;

  }

  

  drawingMap = L.map("drawingMap", {

    center: [initialLat, initialLon],

    zoom: initialZoom,

    zoomControl: true

  });

  

  // Add tile layer

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {

    attribution: '&copy; OpenStreetMap contributors'

  }).addTo(drawingMap);

  

  // Add click handler for drawing

  drawingMap.on('click', function(e) {

    if (isDrawing) {

      addPointToPath(e.latlng);

    }

  });

}



function startDrawingPath() {

  if (isDrawing) return;

  if (!drawingMap) {

    alert("Map is not ready. Please wait a moment and try again.");

    return;

  }



  isDrawing = true;

  currentPathPoints = [];

  

  // Clear any existing path

  if (currentPathPolyline) {

    drawingMap.removeLayer(currentPathPolyline);

    currentPathPolyline = null;

  }

  

  // Clear all markers from drawing map

  drawingMap.eachLayer(function(layer) {

    if (layer instanceof L.Marker) {

      drawingMap.removeLayer(layer);

    }

  });

  

  document.getElementById("startDrawingBtn").style.display = "none";

  document.getElementById("stopDrawingBtn").style.display = "inline-block";

  document.getElementById("savePathBtn").style.display = "none";

  document.getElementById("pathNameInput").style.display = "none";

  document.getElementById("drawingStatus").style.display = "block";

  

  // Change cursor to crosshair

  document.getElementById("drawingMap").style.cursor = "crosshair";

}



function addPointToPath(latlng) {

  if (!isDrawing) return;

  

  currentPathPoints.push([latlng.lat, latlng.lng]);

  

  // Update or create polyline

  if (currentPathPolyline) {

    drawingMap.removeLayer(currentPathPolyline);

  }

  

  if (currentPathPoints.length >= 2) {

    currentPathPolyline = L.polyline(currentPathPoints, {

      color: "#2ecc71",

      weight: 6,

      opacity: 0.8

    }).addTo(drawingMap);

    

    // Show save button and name input when we have at least 2 points

    document.getElementById("savePathBtn").style.display = "inline-block";

    document.getElementById("pathNameInput").style.display = "block";

  }

  

  // Add a marker at the click point

  L.marker(latlng, {

    icon: L.divIcon({

      className: 'path-point-marker',

      html: '<div style="background: #2ecc71; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 2px #2ecc71;"></div>',

      iconSize: [12, 12],

      iconAnchor: [6, 6]

    })

  }).addTo(drawingMap);

}



function stopDrawingPath() {

  isDrawing = false;

  

  // Clear current path

  if (currentPathPolyline) {

    drawingMap.removeLayer(currentPathPolyline);

    currentPathPolyline = null;

  }

  

  // Clear all markers

  if (drawingMap) {

    drawingMap.eachLayer(function(layer) {

      if (layer instanceof L.Marker) {

        drawingMap.removeLayer(layer);

      }

    });

  }

  

  currentPathPoints = [];

  

  document.getElementById("startDrawingBtn").style.display = "inline-block";

  document.getElementById("stopDrawingBtn").style.display = "none";

  document.getElementById("savePathBtn").style.display = "none";

  document.getElementById("pathNameInput").style.display = "none";

  document.getElementById("drawingStatus").style.display = "none";

  

  // Reset cursor

  const mapEl = document.getElementById("drawingMap");

  if (mapEl) {

    mapEl.style.cursor = "";

  }

}



function saveCurrentPath() {

  if (!currentPathPoints || currentPathPoints.length < 2) {

    alert("Path must have at least 2 points. Please add more points by clicking on the map.");

    return;

  }



  const pathName = document.getElementById("pathNameField").value.trim() || `Path ${safePaths.length + 1}`;



  // Add to safe paths

  safePaths.push({

    name: pathName,

    coordinates: currentPathPoints,

    createdAt: new Date().toISOString()

  });



  saveSafePaths();

  renderSafePaths();

  renderSavedPathsList();



  // Clean up

  stopDrawingPath();

  document.getElementById("pathNameField").value = "";

  

  // Show success message

  alert(`Path "${pathName}" saved successfully! It will now appear on the main map.`);

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

          ${path.coordinates.length} points · Created: ${new Date(path.createdAt).toLocaleDateString()}

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
  try {
    const res = await fetch(API);
    const data = await res.json();



    // Detect current activity based on sensor data

    currentStatus = detectActivity(data.hr, data.breathing, data.accel.x, data.accel.y, data.accel.z);

    

    // Update stable activity (requires stability and minimum duration)

    updateActivityStatus(currentStatus);

    updateStatusDisplay();



  // Use CONFIRMED activity for safe ranges, not instant detection

  const ranges = getSafeRanges(confirmedActivity);



  updateSensor("hr", data.hr, ranges.hr.min, ranges.hr.max, "bpm");

  updateSensor("breathing", data.breathing, ranges.breathing.min, ranges.breathing.max, "breaths/min");

  updateSensor("temp", data.temp, ranges.temp.min, ranges.temp.max, "°F");



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
  } catch (error) {
    console.error('Error fetching data:', error);
  }
}





async function fetchAlerts() {
  try {
    const res = await fetch(ALERTS_API);
    alerts = (await res.json()).map(a => ({

      ...a,

      time: new Date(a.timestamp * 1000)

    }));

    renderAlerts();
  } catch (error) {
    console.error('Error fetching alerts:', error);
    alerts = [];
    renderAlerts();
  }
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



  // Context-aware thresholds: danger zone is outside [min-5, max+5] for the current activity

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



function updateStatusDisplay() {

  const statusEl = document.getElementById("statusValue");

  if (!statusEl) return;



  const statusEmoji = {

    sleeping: "🛌",

    resting: "🧘",

    eating: "🍴",

    walking: "🚶",

    exercising: "💪",

    running: "🏃",

    showering: "🚿",

    driving: "🚗",

    napping: "💤",

    unknown: "❓"

  };



  const statusText = {

    sleeping: "Sleeping",

    resting: "Resting",

    eating: "Eating",

    walking: "Walking",

    exercising: "Exercising",

    running: "Running",

    showering: "Showering",

    driving: "Driving",

    napping: "Napping",

    unknown: "Unknown"

  };



  // Use CONFIRMED activity (stable), not instant detection

  statusEl.innerHTML = `${statusEmoji[confirmedActivity] || statusEmoji.unknown} ${statusText[confirmedActivity] || statusText.unknown}`;

}





function updateCO(ppm) {

  const card = document.getElementById("coCard");

  if (!card) return;



  card.classList.remove("safe", "warning", "danger");



  // More lenient CO2 thresholds with 5-minute cooldown between alerts

  let co2Status = "safe";

  const now = Date.now();

  

  if (ppm > 50) {

    co2Status = "danger";

    lastCO2SpikeTime = now;

  } else if (ppm > 15) {

    // Only show warning if cooldown has passed since last spike

    if (now - lastCO2SpikeTime > CO2_SPIKE_COOLDOWN) {

      co2Status = "warning";

      lastCO2SpikeTime = now;

    } else {

      co2Status = "safe";

    }

  }



  card.classList.add(co2Status);



  document.getElementById("coValue").innerText = `${ppm.toFixed(1)} ppm`;



  historyData.co.push({ time: new Date(), value: ppm });

  if (historyData.co.length > 1000) historyData.co.shift();



  saveData();

}



document.addEventListener("click", e => {

  const closeBtn = e.target.closest(".close");

  if (!closeBtn) return;



  const msg = decodeURIComponent(closeBtn.dataset.msg);

  ackAlertGroup(msg);

});



/* ---------- ALERTS ---------- */

// Only run dashboard initialization on index.html, not on settings.html
if (!window.location.pathname.endsWith('settings.html')) {

loadSettings();

loadSafePaths();

applyRefreshIntervals();

// Initialize main map if we're on the dashboard (index.html)
try {
  initializeMainMap();
} catch (e) {
  console.warn('initializeMainMap failed', e);
}

fetchData();

fetchAlerts();

showActiveAlerts();

}

function renderAlerts() {
  const container = document.getElementById("activeAlerts");
  container.innerHTML = "";

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

          line += `<br> Time fallen: $(seconds) seconds`;
        }



        if (a.coords) {

          line += `<br>📍 ${a.coords.lat.toFixed(5)}, ${a.coords.lon.toFixed(5)}`;

        }

      }



      //  WATER SUBMERGENCE (ADDED)

      if (a.type === "WATER") {

        if (a.started_at) {

          const start = a.started_at * 1000;

          const seconds = Math.max(0, Math.floor((now - start) / 1000));

          line += `<br> Time submerged: $(seconds) seconds`;
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

        <span class="close" data-msg="${encodeURIComponent(type)}">×</span>

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

// If we land on the settings page with #safe-paths, initialize drawing map and render saved paths
document.addEventListener('DOMContentLoaded', () => {
  try {
    if (window.location.pathname && window.location.pathname.endsWith('settings.html') && window.location.hash === '#safe-paths') {
      if (!drawingMapInitialized && typeof initializeDrawingMap === 'function') {
        initializeDrawingMap();
        drawingMapInitialized = true;
      }
      // center map if marker exists
      if (typeof drawingMap !== 'undefined' && drawingMap) {
        if (marker && marker.getLatLng) {
          const pos = marker.getLatLng();
          drawingMap.setView([pos.lat, pos.lng], 16);
        } else {
          drawingMap.setView([36.9741, -122.0308], 16);
        }
      }
      if (typeof renderSavedPathsList === 'function') renderSavedPathsList();
    }
  } catch (e) {
    console.warn('Safe paths init failed', e);
  }
});


