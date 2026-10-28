
"use strict";

const API_BASE_URL = "http://localhost:8000";
const REFRESH_INTERVAL = 2000;
const MAX_POINTS = 20;
const MAX_EVENTS = 20;

// HTML elements
const trackerSelect = document.getElementById("trackerSelect");

const temperatureValue = document.getElementById("temperatureValue");
const temperatureStatus = document.getElementById("temperatureStatus");

const shockValue = document.getElementById("shockValue");
const shockStatus = document.getElementById("shockStatus");

const latitude = document.getElementById("latitude");
const longitude = document.getElementById("longitude");
const mapLink = document.getElementById("mapLink");

const deviceIdElement = document.getElementById("deviceId");
const lastUpdate = document.getElementById("lastUpdate");
const eventLog = document.getElementById("eventLog");

// Separate chart data
const temperatureLabels = [];
const temperatureHistory = [];

const shockLabels = [];
const shockHistory = [];

let lastObservedAt = null;
let requestInProgress = false;

// Create temperature chart
const temperatureChart = new Chart(
    document.getElementById("temperatureChart"),
    {
        type: "line",
        data: {
            labels: temperatureLabels,
            datasets: [{
                label: "Temperature (°C)",
                data: temperatureHistory,
                borderColor: "#E08B00",
                backgroundColor: "rgba(224, 139, 0, 0.12)",
                fill: true,
                tension: 0.3,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false
        }
    }
);

// Create shock chart
const shockChart = new Chart(
    document.getElementById("shockChart"),
    {
        type: "line",
        data: {
            labels: shockLabels,
            datasets: [{
                label: "Peak acceleration (g)",
                data: shockHistory,
                borderColor: "#D83B3B",
                backgroundColor: "rgba(216, 59, 59, 0.12)",
                fill: true,
                tension: 0.3,
                spanGaps: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false
        }
    }
);

// Update a status badge
function setBadge(element, message, type = "") {
    element.textContent = message;
    element.className = "badge";

    if (type) {
        element.classList.add(type);
    }
}

// Add an event to the event log
function addEvent(tracker, event, value, timestamp) {
    // Remove the initial waiting row
    if (eventLog.textContent.includes("Waiting for data...")) {
        eventLog.replaceChildren();
    }

    const row = document.createElement("tr");

    const timeCell = document.createElement("td");
    const trackerCell = document.createElement("td");
    const eventCell = document.createElement("td");
    const valueCell = document.createElement("td");

    const parsedTime = new Date(timestamp);

    timeCell.textContent = Number.isNaN(parsedTime.getTime())
        ? new Date().toLocaleTimeString()
        : parsedTime.toLocaleTimeString();

    trackerCell.textContent = tracker;
    eventCell.textContent = event;
    valueCell.textContent = String(value);

    row.append(timeCell, trackerCell, eventCell, valueCell);
    eventLog.prepend(row);

    while (eventLog.children.length > MAX_EVENTS) {
        eventLog.lastElementChild.remove();
    }
}

// Add new sensor readings to the charts
function updateCharts(data) {
    const time = new Date(data.timestamp);

    const label = Number.isNaN(time.getTime())
        ? new Date().toLocaleTimeString()
        : time.toLocaleTimeString();

    if (data.temperatureValid) {
        temperatureLabels.push(label);
        temperatureHistory.push(data.temperature);

        if (temperatureLabels.length > MAX_POINTS) {
            temperatureLabels.shift();
            temperatureHistory.shift();
        }

        temperatureChart.update("none");
    }

    if (data.shockValid) {
        shockLabels.push(label);
        shockHistory.push(data.shock);

        if (shockLabels.length > MAX_POINTS) {
            shockLabels.shift();
            shockHistory.shift();
        }

        shockChart.update("none");
    }
}

// Convert your backend's telemetry item into dashboard values
function normalizeTelemetry(item) {
    const temperatureValid =
        item.temperature_valid === true &&
        typeof item.temperature_c === "number" &&
        Number.isFinite(item.temperature_c);

    const shockValid =
        item.motion_valid === true &&
        typeof item.peak_acceleration_magnitude_g === "number" &&
        Number.isFinite(item.peak_acceleration_magnitude_g);

    const gpsValid =
        item.location_fix_valid === true &&
        typeof item.latitude === "number" &&
        Number.isFinite(item.latitude) &&
        typeof item.longitude === "number" &&
        Number.isFinite(item.longitude) &&
        item.latitude >= -90 &&
        item.latitude <= 90 &&
        item.longitude >= -180 &&
        item.longitude <= 180;

    return {
        deviceId: item.device_id,
        timestamp: item.observed_at,

        temperatureValid,
        temperature: temperatureValid
            ? item.temperature_c
            : null,

        shockValid,
        shock: shockValid
            ? item.peak_acceleration_magnitude_g
            : null,

        gpsValid,
        latitude: gpsValid ? item.latitude : null,
        longitude: gpsValid ? item.longitude : null
    };
}

// Fetch telemetry for the selected tracker
async function fetchTelemetry() {
    // Prevent overlapping requests
    if (requestInProgress) return;

    requestInProgress = true;

    const selectedTracker = trackerSelect.value;
    deviceIdElement.textContent = selectedTracker;

    try {
        const url =
            `${API_BASE_URL}/api/v1/devices/` +
            `${encodeURIComponent(selectedTracker)}/telemetry`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(
                `API request failed: HTTP ${response.status}`
            );
        }

        const result = await response.json();

        // Your API returns telemetry in an "items" array,
        // with the newest record first.
        if (!Array.isArray(result.items)) {
            throw new Error(
                'Unexpected API response: expected an "items" array'
            );
        }

        if (result.items.length === 0) {
            temperatureValue.textContent = "--";
            shockValue.textContent = "--";

            setBadge(temperatureStatus, "No readings", "warning");
            setBadge(shockStatus, "No readings", "warning");

            latitude.textContent = "No GPS fix";
            longitude.textContent = "No GPS fix";
            mapLink.removeAttribute("href");
            lastUpdate.textContent = "No telemetry available";

            return;
        }

        const item = result.items[0];
        const data = normalizeTelemetry(item);

        // Show the device ID returned by the backend, if available
        deviceIdElement.textContent =
            data.deviceId || selectedTracker;

        // Temperature
        if (data.temperatureValid) {
            temperatureValue.textContent =
                data.temperature.toFixed(1);

            setBadge(temperatureStatus, "Valid reading");

        } else {
            temperatureValue.textContent = "--";

            setBadge(
                temperatureStatus,
                "Invalid reading",
                "warning"
            );
        }

        // Shock / peak acceleration
        if (data.shockValid) {
            shockValue.textContent = data.shock.toFixed(2);

            setBadge(shockStatus, "Valid reading");

        } else {
            shockValue.textContent = "--";

            setBadge(
                shockStatus,
                "Invalid reading",
                "warning"
            );
        }

        // GPS coordinates
        if (data.gpsValid) {
            latitude.textContent = data.latitude.toFixed(6);
            longitude.textContent = data.longitude.toFixed(6);

            mapLink.href =
                "https://www.openstreetmap.org/" +
                `?mlat=${data.latitude}&mlon=${data.longitude}` +
                `#map=16/${data.latitude}/${data.longitude}`;

            mapLink.style.display = "inline";

        } else {
            latitude.textContent = "No GPS fix";
            longitude.textContent = "No GPS fix";

            mapLink.removeAttribute("href");
            mapLink.style.display = "none";
        }

        // Display the actual sensor observation timestamp
        const observedDate = new Date(data.timestamp);

        lastUpdate.textContent =
            data.timestamp &&
            !Number.isNaN(observedDate.getTime())
                ? observedDate.toLocaleString()
                : "Unknown";

        // Only add chart points and log entries once per new
        // observation, rather than duplicating data every 2 seconds.
        const observationKey =
            `${selectedTracker}:${data.timestamp}`;

        if (data.timestamp && observationKey !== lastObservedAt) {
            lastObservedAt = observationKey;

            updateCharts(data);

            if (data.temperatureValid) {
                addEvent(
                    selectedTracker,
                    "Temperature",
                    `${data.temperature.toFixed(1)} °C`,
                    data.timestamp
                );
            }

            if (data.shockValid) {
                addEvent(
                    selectedTracker,
                    "Shock",
                    `${data.shock.toFixed(2)} g`,
                    data.timestamp
                );
            }

            if (data.gpsValid) {
                addEvent(
                    selectedTracker,
                    "GPS location",
                    `${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}`,
                    data.timestamp
                );
            }
        }

    } catch (error) {
        console.error("Telemetry API error:", error);

        setBadge(temperatureStatus, "API error", "danger");
        setBadge(shockStatus, "API error", "danger");

        lastUpdate.textContent = "Connection failed";

    } finally {
        requestInProgress = false;
    }
}

// When switching trackers, reset the observation tracking
trackerSelect.addEventListener("change", () => {
    lastObservedAt = null;

    // Clear the old tracker's readings so they aren't confused
    // with the newly selected device.
    temperatureValue.textContent = "--";
    shockValue.textContent = "--";
    latitude.textContent = "--";
    longitude.textContent = "--";
    lastUpdate.textContent = "Loading...";

    temperatureLabels.length = 0;
    temperatureHistory.length = 0;
    shockLabels.length = 0;
    shockHistory.length = 0;

    temperatureChart.update("none");
    shockChart.update("none");

    fetchTelemetry();
});

// Initial API call
fetchTelemetry();

// Refresh sensor readings every 2 seconds
setInterval(fetchTelemetry, REFRESH_INTERVAL);
