/* app.js
   Assumes Flask server on http://10.0.0.75:5000
*/
const SERVER = "http://10.0.0.75:5000";

// UI refs
const latEl = document.getElementById("lat");
const lonEl = document.getElementById("lon");
const accEl = document.getElementById("acc");
const lastEl = document.getElementById("last");
const messagesEl = document.getElementById("messages");
const recordBtn = document.getElementById("record-btn");
const recordStatus = document.getElementById("record-status");
const themeToggle = document.getElementById("theme-toggle");
const loginBtn = document.getElementById("login-btn");
const loginModal = document.getElementById("login-modal");
const doLoginBtn = document.getElementById("do-login");
const closeLogin = document.getElementById("close-login");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("login-error");
const panicBtn = document.getElementById("panic-btn");
const topbar = document.getElementById("topbar");
const alarmAudio = document.getElementById("alarm-audio");

// local state
let token = localStorage.getItem("bp_token") || null;
let currentUser = localStorage.getItem("bp_user") || null;
let mediaRecorder = null;
let audioChunks = [];

// Init theme
if (localStorage.getItem("bp_theme") === "dark") {
  document.documentElement.classList.add("dark");
  themeToggle.textContent = "☀️";
} else {
  themeToggle.textContent = "🌙";
}

// Init map
let map = L.map('map').setView([37.422, -122.084], 17);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
let marker = L.marker([37.422, -122.084]).addTo(map);

// fetch loop
let lastAlertTs = 0;
async function fetchLoop() {
  try {
    const res = await fetch(`${SERVER}/get_data`);
    const data = await res.json();
    if (data.location) updateLocation(data.location);
    if (data.inbox) updateInbox(data.inbox);
    if (data.alerts) checkAlerts(data.alerts);
  } catch (e) {
    console.error("Fetch error", e);
  } finally {
    setTimeout(fetchLoop, 1000);
  }
}
fetchLoop();

function updateLocation(loc) {
  latEl.textContent = loc.lat.toFixed(6);
  lonEl.textContent = loc.lon.toFixed(6);
  accEl.textContent = loc.accuracy;
  lastEl.textContent = new Date(loc.timestamp).toLocaleTimeString();

  marker.setLatLng([loc.lat, loc.lon]);
  map.setView([loc.lat, loc.lon]);
}

function updateInbox(inbox) {
  messagesEl.innerHTML = "";
  // newest last (chronological)
  inbox.slice().reverse().forEach(item => {
    const li = document.createElement("li");
    if (item.type === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = `${SERVER}${item.url}`;
      li.appendChild(audio);
      const meta = document.createElement("div");
      meta.textContent = `${item.from} • ${new Date(item.ts).toLocaleTimeString()}`;
      li.appendChild(meta);
    } else {
      li.textContent = `${item.from}: ${item.message} • ${new Date(item.ts).toLocaleTimeString()}`;
    }
    messagesEl.appendChild(li);
  });
}

function checkAlerts(alerts) {
  if (!alerts || alerts.length === 0) return;
  const lastAlert = alerts[alerts.length - 1];
  if (lastAlert.ts > lastAlertTs) {
    lastAlertTs = lastAlert.ts;
    // if fall or submerged, show alarm behavior
    if (lastAlert.type === "fall" || lastAlert.type === "submerged") {
      triggerAlarm(lastAlert);
    }
  }
}

function triggerAlarm(alert) {
  // Visual pulse
  topbar.classList.add("pulse-alarm");
  // Play beep (use system beep or small tone)
  try {
    alarmAudio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    alarmAudio.play();
  } catch(e){}

  // show confirm after 10s
  setTimeout(() => {
    topbar.classList.remove("pulse-alarm");
    const call = confirm(`ALERT: ${alert.type.toUpperCase()}\n${alert.message}\nCall emergency services?`);
    if (call) {
      // open phone link or show coordinates
      fetch(`${SERVER}/get_data`).then(r=>r.json()).then(data=>{
        const loc = data.location;
        const text = `Emergency: ${alert.type} at ${loc.lat},${loc.lon}`;
        // show it (for desktop we can't call, so instruct)
        alert(`Call emergency services. Share this info:\n${text}`);
        // Optionally copy to clipboard
        try { navigator.clipboard.writeText(text); } catch(e){}
      });
    }
  }, 10000);
}

// Theme toggle
themeToggle.addEventListener("click", () => {
  document.documentElement.classList.toggle("dark");
  if (document.documentElement.classList.contains("dark")) {
    localStorage.setItem("bp_theme", "dark");
    themeToggle.textContent = "☀️";
  } else {
    localStorage.setItem("bp_theme", "light");
    themeToggle.textContent = "🌙";
  }
});

// Login modal
loginBtn.addEventListener("click", () => loginModal.classList.remove("hidden"));
closeLogin.addEventListener("click", () => loginModal.classList.add("hidden"));

doLoginBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  loginError.textContent = "";
  try {
    const res = await fetch(`${SERVER}/login`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({username,password})
    });
    if (res.status === 200) {
      const j = await res.json();
      token = j.token;
      currentUser = j.username;
      localStorage.setItem("bp_token", token);
      localStorage.setItem("bp_user", currentUser);
      loginModal.classList.add("hidden");
      loginError.textContent = "";
      loginBtn.textContent = `Logged: ${currentUser}`;
    } else {
      const j = await res.json();
      loginError.textContent = j.message || "Login failed";
    }
  } catch(e){ loginError.textContent = "Network error"; }
});

// Panic button
panicBtn.addEventListener("click", async () => {
  // fetch latest coords and show instructions
  const r = await fetch(`${SERVER}/get_data`); const data = await r.json();
  const loc = data.location;
  const text = `Emergency! Please call your local emergency number and share coordinates:\nLat: ${loc.lat}\nLon: ${loc.lon}`;
  const call = confirm(text + "\n\nClick OK to copy coordinates to clipboard.");
  if (call) {
    try { await navigator.clipboard.writeText(`Lat:${loc.lat}, Lon:${loc.lon}`); alert("Coordinates copied to clipboard"); }
    catch(e){ alert("Copy failed — manually share the coordinates"); }
  }
});

// Record (press & hold)
recordBtn.addEventListener("mousedown", async () => {
  recordStatus.textContent = "Requesting mic...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    recordStatus.textContent = "Recording...";
    recordBtn.style.transform = "scale(0.98)";
  } catch (e) {
    recordStatus.textContent = "Mic denied";
  }
});

recordBtn.addEventListener("mouseup", async () => {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
  recordStatus.textContent = "Uploading...";
  recordBtn.style.transform = "";

  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, {type: "audio/webm"});
    // upload (requires token)
    const fd = new FormData();
    fd.append("audio", blob, "message.webm");
    try {
      const headers = token ? { "X-Auth-Token": token } : {};
      const res = await fetch(`${SERVER}/send_audio`, { method: "POST", body: fd, headers });
      if (res.status === 200) {
        recordStatus.textContent = "Sent";
      } else if (res.status === 401) {
        recordStatus.textContent = "Login required to send";
        alert("Please log in as caregiver to send messages");
      } else {
        recordStatus.textContent = "Upload error";
      }
    } catch (e) {
      recordStatus.textContent = "Network error";
    }
    setTimeout(()=> recordStatus.textContent = "Idle", 1500);
  };
});

// Support touch events for mobile (touchstart / touchend)
recordBtn.addEventListener("touchstart", (e)=>{ e.preventDefault(); recordBtn.dispatchEvent(new Event('mousedown')); });
recordBtn.addEventListener("touchend", (e)=>{ e.preventDefault(); recordBtn.dispatchEvent(new Event('mouseup')); });

