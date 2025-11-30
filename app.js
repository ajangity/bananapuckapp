// app.js
// Change this if your PC IP changes:
const SERVER = "http://10.0.0.75:5000";

let map, marker;

// ---------- MAP SETUP ----------
window.addEventListener("load", () => {
    const mapEl = document.getElementById("map");
    if (mapEl) {
        map = L.map("map").setView([37.422, -122.084], 17);

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19
        }).addTo(map);

        marker = L.marker([37.422, -122.084]).addTo(map);
    }

    // start polling after map is ready
    setInterval(fetchData, 1000);
});

// ---------- FETCH + UPDATE UI ----------
async function fetchData() {
    try {
        const res = await fetch(`${SERVER}/get_data`);
        const data = await res.json();

        // Safety: log once in console to verify
        console.log("Data from server:", data);

        // Vitals
        setText("heartRate", formatBpm(data.hr));
        setText("respirationRate", formatResp(data.breathing));
        setText("temperature", formatTemp(data.temp));
        setText("waterSub", data.water_submerged ? "Submerged" : "Dry");

        // Orientation (array: [roll, pitch, yaw])
        if (Array.isArray(data.orientation)) {
            setText("roll", `Roll: ${roundOrDash(data.orientation[0])}`);
            setText("pitch", `Pitch: ${roundOrDash(data.orientation[1])}`);
            setText("yaw", `Yaw: ${roundOrDash(data.orientation[2])}`);
        }

        // Accel
        if (data.accel) {
            setText("accelX", `X: ${roundOrDash(data.accel.x)}`);
            setText("accelY", `Y: ${roundOrDash(data.accel.y)}`);
            setText("accelZ", `Z: ${roundOrDash(data.accel.z)}`);
        }

        // Gyro
        if (data.gyro) {
            setText("gyroX", `X: ${roundOrDash(data.gyro.x)}`);
            setText("gyroY", `Y: ${roundOrDash(data.gyro.y)}`);
            setText("gyroZ", `Z: ${roundOrDash(data.gyro.z)}`);
        }

        // LiDAR
        setText("lidarDist", data.distance_m != null ? `${data.distance_m} m` : "-- m");

        // GPS
        if (data.gps) {
            if (data.gps.lat != null && data.gps.lon != null) {
                setText("gpsLat", `Lat: ${data.gps.lat.toFixed(6)}`);
                setText("gpsLon", `Lon: ${data.gps.lon.toFixed(6)}`);
            }
            if (data.gps.accuracy != null) {
                setText("gpsAcc", `Accuracy: ${data.gps.accuracy} m`);
            }

            // Update map marker
            if (map && marker && data.gps.lat != null && data.gps.lon != null) {
                const latlng = [data.gps.lat, data.gps.lon];
                marker.setLatLng(latlng);
                map.setView(latlng);
            }
        }

        // ECG
        setText("ecgVal", data.ecg != null ? data.ecg : "--");

        // Actuator
        if (data.actuator_event) {
            let s = data.actuator_event;
            if (data.actuator_strength != null) s += ` (strength ${data.actuator_strength})`;
            if (data.actuator_duration != null) s += ` for ${data.actuator_duration}s`;
            setText("actuatorEvent", s);
        } else {
            setText("actuatorEvent", "--");
        }

        // Audio
        if (data.audio_start) {
            setText("audioStatus", "Recording…");
        } else if (data.audio_end) {
            setText("audioStatus", "Last clip finished");
        } else {
            setText("audioStatus", "Idle");
        }

        // Timestamp
        if (data.timestamp) {
            const dt = new Date(data.timestamp);
            setText("lastUpdate", dt.toLocaleTimeString());
        }

    } catch (err) {
        console.error("Error fetching data:", err);
    }
}

// ---------- Helper functions ----------
function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function roundOrDash(val) {
    return (val == null ? "--" : Math.round(val * 100) / 100);
}

function formatBpm(val) {
    return val == null ? "-- bpm" : `${val} bpm`;
}

function formatResp(val) {
    return val == null ? "-- breaths/min" : `${val} breaths/min`;
}

function formatTemp(val) {
    return val == null ? "-- °C" : `${val} °C`;
}
