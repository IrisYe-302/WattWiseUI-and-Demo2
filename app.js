const ports = [
  { port: "Port A", room: "Kitchen", status: "Online", devices: [
    { name: "Kitchen fridge", watts: 320, level: "Critical", icon: "refrigerator", detail: "Cooling normally" },
    { name: "Dishwasher", watts: 0, level: "Flexible", icon: "washing-machine", detail: "Scheduled for 10:30 PM" }
  ]},
  { port: "Port B", room: "Living room", status: "Online", devices: [
    { name: "Wi-Fi router", watts: 18, level: "Important", icon: "router", detail: "8 devices connected" },
    { name: "Living room TV", watts: 12, level: "Flexible", icon: "tv", detail: "Standby for 3h 24m" },
    { name: "Game console", watts: 9, level: "Flexible", icon: "gamepad-2", detail: "Standby for 4h 10m" }
  ]},
  { port: "Port C", room: "Bedroom", status: "Online", devices: [
    { name: "Medical cooler", watts: 74, level: "Critical", icon: "briefcase-medical", detail: "Always protected" },
    { name: "Bedside lamp", watts: 6, level: "Flexible", icon: "lamp-desk", detail: "Off" }
  ]}
];

const suggestions = [
  { title: "Pause standby entertainment", body: "Your TV and game console are idle. Pause both now and restore power when you return.", impact: "Best match", icon: "power", watts: "21 W", savings: "$8.30 / year" },
  { title: "Run the dishwasher after 10 PM", body: "Tonight’s grid demand is forecast to fall after 10 PM. Your dishes will still be ready by morning.", impact: "Low effort", icon: "clock-3", watts: "1.2 kWh", savings: "$4.10 / month" }
];

const portList = document.querySelector("#portList");
const suggestionList = document.querySelector("#suggestionList");

function renderPorts() {
  portList.innerHTML = ports.map((port, portIndex) => `
    <article class="port-card ${port.devices.length ? "" : "empty-port"}">
      <header class="port-card-header">
        <div class="port-symbol"><i data-lucide="blocks"></i></div>
        <div><span class="port-kicker">${port.status}</span><h3>${port.port}</h3><p>${port.room} · ${port.devices.length} ${port.devices.length === 1 ? "device" : "devices"}</p></div>
        <strong>${port.devices.reduce((total, device) => total + device.watts, 0)} W</strong>
      </header>
      <div class="nested-devices">
        ${port.devices.length ? port.devices.map((device, deviceIndex) => `
          <div class="nested-device">
            <div class="device-icon"><i data-lucide="${device.icon}"></i></div>
            <div class="nested-device-copy"><h4>${device.name}</h4><p>${device.detail}</p></div>
            <span class="nested-watts">${device.watts} W</span>
            <label><span class="sr-only">Criticality for ${device.name} on ${port.port}</span><select class="criticality-select" data-port="${portIndex}" data-device="${deviceIndex}">
              ${["Critical", "Important", "Flexible"].map(level => `<option ${level === device.level ? "selected" : ""}>${level}</option>`).join("")}
            </select></label>
            <button class="edit-device" data-edit-port="${portIndex}" data-edit-device="${deviceIndex}" aria-label="Edit ${device.name}"><i data-lucide="pencil"></i></button>
          </div>`).join("") : `<p class="empty-message">No devices assigned yet.</p>`}
      </div>
      <button class="add-device-to-port" data-add-port="${portIndex}"><i data-lucide="plus"></i>Add device to ${port.port}</button>
    </article>`).join("");
  if (window.lucide) lucide.createIcons();
}

renderPorts();

suggestionList.innerHTML = suggestions.map((item, index) => `
  <article class="suggestion-card">
    <div class="suggestion-top"><div class="device-icon"><i data-lucide="${item.icon}"></i></div><span class="impact-pill">${item.impact}</span></div>
    <h3>${item.title}</h3><p>${item.body}</p>
    <div class="suggestion-stats"><span>Impact<strong>${item.watts}</strong></span><span>Estimated saving<strong>${item.savings}</strong></span></div>
    <button class="button suggestion-apply" data-suggestion="${index}">Review & apply</button>
  </article>`).join("");

if (window.lucide) lucide.createIcons();

const shell = document.querySelector(".app-shell");
const panel = document.querySelector(".assistant-panel");
const scrim = document.querySelector(".scrim");
const toast = document.querySelector(".toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function openAssistant(seed) {
  shell.classList.add("assistant-visible");
  panel.setAttribute("aria-hidden", "false");
  if (innerWidth <= 1100) scrim.hidden = false;
  if (seed) {
    document.querySelector("#chatInput").value = seed;
    document.querySelector("#chatInput").focus();
  }
}

function closeAssistant() {
  shell.classList.remove("assistant-visible");
  panel.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
}

document.querySelectorAll(".assistant-open").forEach(button => button.addEventListener("click", () => openAssistant()));
document.querySelector(".assistant-close").addEventListener("click", closeAssistant);
scrim.addEventListener("click", closeAssistant);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAssistant(); });
document.querySelectorAll(".ask-assistant").forEach(button => button.addEventListener("click", () => openAssistant("Why is it safe to pause these devices?")));

function navigate(sectionId) {
  document.querySelectorAll(".dashboard-section").forEach(section => section.classList.toggle("active", section.id === sectionId));
  document.querySelectorAll("[data-section]").forEach(link => link.classList.toggle("active", link.dataset.section === sectionId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-section]").forEach(link => link.addEventListener("click", event => {
  event.preventDefault();
  navigate(link.dataset.section);
}));
document.querySelectorAll("[data-nav-to]").forEach(link => link.addEventListener("click", event => {
  event.preventDefault(); navigate(link.dataset.navTo);
}));

const modeCopy = {
  normal: ["Normal", "Everything runs normally. Wattwise still watches for unusual or wasteful use.", "2.2"],
  saver: ["Smart saver", "Non-essential standby loads pause automatically when nobody is using them.", "1.8"],
  outage: ["Backup protection", "Grid power is unavailable. Critical devices are protected and flexible loads are paused.", "0.8"]
};

document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => {
  const mode = button.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach(item => item.classList.toggle("active", item === button));
  document.querySelector("#modeTitle").textContent = modeCopy[mode][0];
  document.querySelector("#modeDescription").textContent = modeCopy[mode][1];
  document.querySelector("#livePower").textContent = modeCopy[mode][2];
  document.querySelector("#modeBanner").dataset.state = mode;
  showToast(`${modeCopy[mode][0]} mode is active`);
}));

document.querySelector("#applySuggestion").addEventListener("click", event => {
  event.currentTarget.textContent = "Paused · 21 W saved";
  event.currentTarget.disabled = true;
  document.querySelector("#livePower").textContent = "1.78";
  document.querySelector("#quickInsight").querySelector(".new-label").textContent = "SAVING ENERGY NOW";
  showToast("TV and game console paused safely");
});

portList.addEventListener("change", event => {
  if (!event.target.matches("select")) return;
  const port = ports[Number(event.target.dataset.port)];
  const device = port.devices[Number(event.target.dataset.device)];
  device.level = event.target.value;
  showToast(`${device.name} on ${port.port} set to ${device.level.toLowerCase()}`);
});

const deviceDialog = document.querySelector("#deviceDialog");
const deviceForm = document.querySelector("#deviceForm");
let activePortIndex = null;
let activeDeviceIndex = null;

portList.addEventListener("click", event => {
  const button = event.target.closest("[data-add-port], [data-edit-port]");
  if (!button) return;
  activePortIndex = Number(button.dataset.addPort ?? button.dataset.editPort);
  activeDeviceIndex = button.dataset.editDevice === undefined ? null : Number(button.dataset.editDevice);
  const port = ports[activePortIndex];
  const device = activeDeviceIndex === null ? null : port.devices[activeDeviceIndex];
  document.querySelector("#dialogPortName").textContent = port.port;
  document.querySelector("#deviceDialogTitle").textContent = device ? "Edit device" : "Add a device";
  document.querySelector("#deviceName").value = device?.name || "";
  document.querySelector("#deviceCriticality").value = device?.level || "Flexible";
  deviceDialog.showModal();
  document.querySelector("#deviceName").focus();
});

function closeDeviceDialog() {
  deviceDialog.close();
  activePortIndex = null;
  activeDeviceIndex = null;
}

document.querySelector("#closeDeviceDialog").addEventListener("click", closeDeviceDialog);
document.querySelector("#cancelDeviceDialog").addEventListener("click", closeDeviceDialog);

deviceForm.addEventListener("submit", event => {
  event.preventDefault();
  if (activePortIndex === null) return;
  const name = document.querySelector("#deviceName").value.trim();
  if (!name) return;
  const port = ports[activePortIndex];
  const device = { name, level: document.querySelector("#deviceCriticality").value, detail: "Newly assigned", icon: "plug-zap", watts: 0 };
  if (activeDeviceIndex === null) port.devices.push(device);
  else port.devices[activeDeviceIndex] = { ...port.devices[activeDeviceIndex], ...device };
  deviceDialog.close();
  renderPorts();
  showToast(`${name} ${activeDeviceIndex === null ? "added to" : "updated on"} ${port.port}`);
  activePortIndex = null;
  activeDeviceIndex = null;
});

document.querySelector("#registerPort").addEventListener("click", () => {
  showToast("Ready to pair a new Wattwise port");
});

const discoveryButton = document.querySelector("#startDiscovery");
const discoveryProgress = document.querySelector("#discoveryProgress");
const discoveryResults = document.querySelector("#discoveryResults");
const scanStatus = document.querySelector("#scanStatus");
const scanDetail = document.querySelector("#scanDetail");
const scanBar = document.querySelector("#scanBar");
let discoveryTimers = [];

function scheduleDiscovery(callback, delay) {
  discoveryTimers.push(window.setTimeout(callback, delay));
}

discoveryButton.addEventListener("click", () => {
  discoveryTimers.forEach(window.clearTimeout);
  discoveryTimers = [];
  discoveryResults.hidden = true;
  discoveryProgress.hidden = false;
  discoveryButton.disabled = true;
  discoveryButton.classList.add("scanning");
  discoveryButton.querySelector("span").textContent = "Scanning…";
  scanBar.style.width = "18%";
  scanStatus.textContent = "Listening for smart devices…";
  scanDetail.textContent = "Checking Matter, Wi-Fi and Wattwise ports";

  scheduleDiscovery(() => {
    scanBar.style.width = "55%";
    scanStatus.textContent = "Learning power signatures…";
    scanDetail.textContent = "Comparing recent switching and standby patterns";
  }, 850);

  scheduleDiscovery(() => {
    scanBar.style.width = "84%";
    scanStatus.textContent = "Building an outage plan…";
    scanDetail.textContent = "Protecting critical loads and flagging manual devices";
  }, 1750);

  scheduleDiscovery(() => {
    scanBar.style.width = "100%";
    discoveryProgress.hidden = true;
    discoveryResults.hidden = false;
    discoveryButton.disabled = false;
    discoveryButton.classList.remove("scanning");
    discoveryButton.querySelector("span").textContent = "Scan again";
    document.querySelectorAll(".discovered-load").forEach((load, index) => {
      load.classList.remove("revealed");
      scheduleDiscovery(() => load.classList.add("revealed"), index * 130);
    });
    showToast("3 loads identified · 2 can respond automatically");
  }, 2650);
});

document.querySelector(".ask-discovery").addEventListener("click", () => {
  openAssistant("How did Wattwise identify these devices?");
});

suggestionList.addEventListener("click", event => {
  const button = event.target.closest(".suggestion-apply");
  if (!button) return;
  const item = suggestions[Number(button.dataset.suggestion)];
  button.textContent = "Applied";
  button.disabled = true;
  showToast(`${item.title} applied`);
});

const responses = {
  "what can i safely turn off?": "You can safely pause the living room TV and game console. They’ve both been idle for over 3 hours and are marked Flexible. That saves 21 W. I’ll leave the fridge, medical cooler, and router untouched.",
  "how long would backup power last?": "At the current protected load, your estimated backup is 9 hours 40 minutes. Pausing flexible devices would extend that by about 1 hour 15 minutes.",
  "explain my critical devices": "Your kitchen fridge and medical cooler are Critical, so Wattwise never interrupts them. Your router is Important: it stays on in Saver mode, but you can choose how it behaves during a long outage.",
  "how did wattwise identify these devices?": "Wattwise combines direct discovery for connected plugs with local power-signature matching. The medical cooler and TV report that they can be controlled. The desk lamp only matches a measured switching pattern, so Wattwise labels it inferred and never claims it can switch it remotely."
};

function addMessage(text, type) {
  const message = document.createElement("div");
  message.className = `message ${type}-message`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.append(paragraph);
  document.querySelector("#chatLog").append(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

function answerAssistant(text) {
  const exact = responses[text.toLowerCase()];
  const fallback = text.toLowerCase().includes("safe") || text.toLowerCase().includes("turn off")
    ? responses["what can i safely turn off?"]
    : "Based on your current home data, I’d start with the 21 W of flexible standby use. Your critical devices remain protected, and I’ll always ask before changing an Important device.";
  window.setTimeout(() => addMessage(exact || fallback, "assistant"), 450);
}

document.querySelector("#chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = document.querySelector("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, "user");
  input.value = "";
  answerAssistant(text);
});

document.querySelector(".suggested-prompts").addEventListener("click", event => {
  if (event.target.tagName !== "BUTTON") return;
  const text = event.target.textContent;
  addMessage(text, "user");
  event.target.parentElement.remove();
  answerAssistant(text);
});

window.addEventListener("resize", () => {
  if (innerWidth > 1100) scrim.hidden = true;
  else if (shell.classList.contains("assistant-visible")) scrim.hidden = false;
});
