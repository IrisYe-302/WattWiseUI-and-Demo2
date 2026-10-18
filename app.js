// Demo model. Every number on the page is derived from these values, so the screens always agree.
const MODEL = {
  batteryKWh: 13.5,        // one home battery
  charge: 0.82,            // current state of charge
  usable: 0.9,             // share of the stored energy the inverter can deliver
  pricePerKWh: 0.385,      // SCE TOU-D-4-9PM, weighted for a load that runs around the clock
  usualKW: 1.3,            // this household's usual draw at this time of day
  waterHeaterKW: 0.38,     // deferred by Saver mode
  approvedStandbyKW: 0.02, // standby loads the household already approved for automatic pause
  dailyKWh: 11.1,          // average daily use this month (matches the History chart)
  budget: 150,
  standbyHoursPerDay: WattwiseEstimates.ASSUMPTIONS.standbyHoursPerDay
};

// Illustrative plan prices for this simulation; not verified current utility tariffs.
const PLANS = {
  sce: { label: "SCE TOU-D-4-9PM", price: 0.385, peakDiff: 0.24, note: "Illustrative Southern California Edison time-of-use example. Standby load is priced at about 38.5¢/kWh averaged over the day; the 4 to 9 PM peak costs about 24¢/kWh more than off-peak." },
  ladwp: { label: "LADWP R-1A", price: 0.30, peakDiff: 0, note: "Illustrative Los Angeles Department of Water and Power tiered example, about 30¢/kWh. The price does not change by time of day, so shifting loads saves no money, only peak demand." }
};
const DEFAULT_PROFILE = { name: "Iris M.", home: "Iris’s home", role: "Owner", budget: 150, plan: "sce" };
const STORE_KEY = "wattwise.profile";
let profile = { ...DEFAULT_PROFILE };
try { profile = { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") }; } catch (error) { /* storage blocked: use defaults */ }
if (!PLANS[profile.plan]) profile.plan = "sce";
const plan = () => PLANS[profile.plan];
const firstName = () => profile.name.trim().split(/\s+/)[0] || "there";
const initials = () => profile.name.trim().split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "?";

const ports = [
  { port: "Port A", room: "Kitchen", status: "Online", devices: [
    { name: "Kitchen fridge", watts: 72, level: "Critical", icon: "refrigerator", detail: "Cooling normally · 72 W average" },
    { name: "Dishwasher", watts: 0, level: "Flexible", icon: "washing-machine", detail: "Scheduled for 10:30 PM" }
  ]},
  { port: "Port B", room: "Living room", status: "Online", devices: [
    { name: "Wi-Fi router", watts: 18, level: "Important", icon: "router", detail: "8 devices connected" },
    { name: "Living room TV", watts: 12, level: "Flexible", icon: "tv", detail: "Standby for 3h 24m", standby: true },
    { name: "Game console", watts: 9, level: "Flexible", icon: "gamepad-2", detail: "Standby for 4h 10m", standby: true }
  ]},
  { port: "Port C", room: "Bedroom", status: "Online", devices: [
    { name: "Medical cooler", watts: 74, level: "Critical", icon: "briefcase-medical", detail: "Insulin storage" },
    { name: "Bedside lamp", watts: 0, level: "Flexible", icon: "lamp-desk", detail: "Off" }
  ]}
];

const suggestions = [
  { id: "standby", title: "Pause standby entertainment", body: "Your TV and game console sit on standby about 20 hours a day. Review which Flexible devices can pause. Restore power with Restore now when you need them again.", impact: "Best match", icon: "power", watts: "21 W", savings: "", applied: false },
  { id: "dishwasher", title: "Run the dishwasher after 9 PM", body: "", impact: "Low effort", icon: "clock-3", watts: "1.2 kWh per run", savings: "", applied: false }
];

// Weekly use in kWh, the same week last month and this month. The History page and the bill card read from here.
const HISTORY = [
  { week: "Sep 21", last: 88, now: 79 },
  { week: "Sep 28", last: 92, now: 81 },
  { week: "Oct 5", last: 86, now: 77 },
  { week: "Oct 12", last: 83, now: 74 }
];
const DAILY = [
  { day: "Oct 11", last: 12.0, now: 10.8 }, { day: "Oct 12", last: 12.3, now: 10.9 }, { day: "Oct 13", last: 11.6, now: 10.3 },
  { day: "Oct 14", last: 11.9, now: 10.7 }, { day: "Oct 15", last: 12.1, now: 10.9 }, { day: "Oct 16", last: 11.8, now: 10.4 },
  { day: "Oct 17", last: 11.3, now: 10.0 }
];
// Where the 4-week energy savings came from (sums to the History total), and the energy moved out of the 4 to 9 PM peak.
const SOURCES = [
  { icon: "plug-zap", name: "Chargers, printer and PC overnight", how: "Approved standby · cut automatically every night", kwh: 18, hours: 672 },
  { icon: "leaf", name: "Saver baseline", how: "Lights and idle loads off while nobody is home", kwh: 12, hours: 0 },
  { icon: "tv", name: "TV and game console standby", how: "Paused while idle · about 14 hours a day", kwh: 8, hours: 784 }
];
const SHIFT = { kwh: 34, what: "Water heater and dishwasher" };
const savedKWh = HISTORY.reduce((sum, w) => sum + w.last - w.now, 0);
const savedPerDay = savedKWh / (HISTORY.length * 7);
const shiftSavings = () => SHIFT.kwh * plan().peakDiff;

// Activity log: past events for the demo home, plus everything that happens in this session.
const ACTIVITY_SEED = [
  { type: "savings", when: "Oct 16, 9:42 PM", icon: "tv", title: "TV and game console left on standby", detail: "Idle for 3 hours. Wattwise suggested pausing them and is waiting for approval.", channel: "wifi" },
  { type: "savings", when: "Oct 16, 9:00 PM", icon: "clock-3", title: "Water heater moved out of the 4 to 9 PM peak", detail: () => plan().peakDiff > 0 ? `Ran 9:00 to 10:10 PM. 1.4 kWh at the off-peak price saved $${(1.4 * plan().peakDiff).toFixed(2)}.` : "Ran 9:00 to 10:10 PM, after the evening peak. Your plan has one price, so this eased the grid rather than your bill.", channel: "wifi" },
  { type: "network", when: "Oct 15, 2:13 AM", icon: "wifi-off", title: "Wi-Fi dropped for 4 minutes", detail: "The router restarted for an update. Wattwise kept control through the power line: 2 commands delivered, none lost.", channel: "line" },
  { type: "savings", when: "Oct 13, 11:30 PM", icon: "plug-zap", title: "Chargers and printer switched off overnight", detail: "Approved standby, 20 W for 8 hours.", channel: "wifi" },
  { type: "protection", when: "Oct 9, 3:05 PM", icon: "shield-check", title: "Medical cooler marked Critical", detail: "Set by Iris. Kept powered at every simulated level.", channel: "app" },
  { type: "outage", when: "Oct 4, 6:40 PM", icon: "battery-charging", title: "Grid outage, 2 h 10 m", detail: "Utility repair on the feeder. Level 3 on battery; every critical device stayed on. Battery 82% to 68%.", channel: "wifi" }
];
const liveActivity = [];
let activityFilter = "all";
let historyPeriod = "weeks";
function logEvent(type, icon, title, detail, channel = "wifi") {
  const time = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  liveActivity.unshift({ type, icon, title, detail, channel, when: `Today, ${time}`, live: true });
  if (typeof renderActivity === "function") renderActivity();
}

// Levels: 0 Normal, 1 Cut waste, 2 Defer, 3 On battery, 4 Critical only. Saver mode runs levels 1 and 2 every day.
const state = { mode: "saver", level: 2, outageHours: 48 };
let stepDownTimer = null;
let deviceView = "ports";
let chartTransitionLabel = "";
let chartFocusIndex = 16;
const INITIAL_PORTS = JSON.parse(JSON.stringify(ports));
const GUIDE = [
  { title: "Start clean", say: "This is Iris’s home: what it uses now, and the bill on track for the month.", run: () => resetDemoState() },
  { title: "Turn on Saver", say: "Every day Wattwise cuts approved standby loads and moves the water heater to cheaper hours: 0.4 kW less.", run: () => setMode("saver", true) },
  { title: "Approve the standby suggestion", say: "Each approval teaches Wattwise what can safely pause. This one is worth about $59 a year.", run: () => applySuggestion(0) },
  { title: "Scan the home", say: "Wattwise finds what is plugged in, recognizes it by its power signature, and decides which loads can respond in an outage. The household still decides what is critical.", run: () => { navigate("ports"); $("#startDiscovery").click(); } },
  { title: "Wildfire shutoff, 48 hours", say: "Level 3 would last about 11 hours. The shutoff is 48. Watch it step down to critical only: about 60 hours.", run: () => { navigate("overview"); state.outageHours = 48; setMode("outage", true); } },
  { title: "Ask the assistant", say: "Anyone in the home can ask how long the power will last, in plain words.", run: () => { openAssistant(); addMessage("How long would backup power last?", "user"); answerAssistant("How long would backup power last?"); } },
  { title: "Restore power", say: "When the grid returns, everything comes back on its own.", run: () => { closeAssistant(); setMode("saver", true); } },
  { title: "Show the progress", say: "Over four weeks: 11% less energy, enough to run the fridge for three weeks.", run: () => navigate("history") }
];
const guideDone = new Set();
const INITIAL_CHAT = document.querySelector("#chatLog").innerHTML;
const readNotifications = new Set();

const $ = selector => document.querySelector(selector);
const portList = $("#portList");
const suggestionList = $("#suggestionList");
const LEVEL_CLASS = { Critical: "high", Important: "medium", Flexible: "low" };

/* ---------- derived numbers ---------- */
const allDevices = () => ports.flatMap(port => port.devices);
const isProtected = device => device.level !== "Flexible";
const standbyPaused = () => suggestions[0].applied;
// Only Flexible standby devices are ever paused; a device the household marks Critical or Important stays on.
const isStandbyPaused = device => device.standby && standbyPaused() && device.level === "Flexible";

// What a device draws right now, given the level and approvals.
const outageCut = device => state.mode === "outage" && device.level === "Flexible" && (state.level >= 4 || device.standby);
function deviceDraw(device) {
  if (device.liveShed) return 0;            // live.js: shed by the real power-line bus
  if (outageCut(device)) return 0;
  if (isStandbyPaused(device)) return 0;
  return device.watts;
}
function deviceDetail(device) {
  if (device.liveDetail) return device.liveDetail;   // live.js: real node status
  if (outageCut(device)) return state.level >= 4 ? "Paused · protected-device backup" : "Paused · standby waste cut on battery";
  if (isStandbyPaused(device)) return "Paused by suggestion · use Restore now";
  return device.detail;
}
const protectedKW = () => allDevices().filter(isProtected).reduce((sum, d) => sum + d.watts, 0) / 1000;
const availableKWh = () => MODEL.batteryKWh * MODEL.charge * MODEL.usable;

function homeKW(level = state.level) {
  if (state.mode === "outage" && level >= 4) return protectedKW();
  let kw = MODEL.usualKW;
  if (level >= 1) kw -= MODEL.approvedStandbyKW;
  if (level >= 2) kw -= MODEL.waterHeaterKW;
  const standby = allDevices().filter(d => d.standby && d.level === "Flexible" && (level >= 3 || standbyPaused()));
  kw -= standby.reduce((sum, d) => sum + d.watts, 0) / 1000;
  return Math.max(kw, protectedKW());
}
const runtimeAt = level => availableKWh() / homeKW(level);

function hoursLabel(hours) {
  if (!isFinite(hours)) return "--";
  const h = Math.floor(hours), m = Math.round((hours - h) * 60);
  return m === 60 ? `${h + 1}h 00m` : `${h}h ${String(m).padStart(2, "0")}m`;
}
const money = value => value >= 100 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`;
const kwLabel = kw => kw < 1 ? kw.toFixed(2).replace(/0$/, "") : kw.toFixed(1);

/* ---------- illustrative history with state-derived current endpoint ---------- */
// Earlier samples are fixed demo history. Mode/actions change the current endpoint only.
const CHART_HISTORY = [0.43, 0.51, 0.48, 0.69, 0.73, 0.62, 0.55, 0.67, 0.89, 1.08, 1.19, 1.42, 1.32, 1.12, 0.98, 0.92];
const CHART_USUAL = [0.58, 0.66, 0.65, 0.87, 0.96, 0.87, 0.82, 0.96, 1.17, 1.38, 1.49, 1.72, 1.64, 1.49, 1.39, 1.32, MODEL.usualKW];
const chartClock = date => date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
function chartSamples() { return [...CHART_HISTORY, homeKW()]; }
function chartReadout(index) {
  const value = chartSamples()[index], usual = CHART_USUAL[index];
  const time = index === 16 ? "Now" : chartClock(new Date(Date.now() - (16 - index) * 30 * 60000));
  $("#usageReadout").innerHTML = `<span>${time} <small>· simulated</small></span><strong>${Math.round(value * 1000)} W <small>use</small></strong><span>${Math.round(usual * 1000)} W usual</span><span class="chart-saving">${Math.round(Math.abs(usual - value) * 1000)} W ${value <= usual ? "lower" : "higher"}</span>`;
}
function renderUsageChart() {
  const values = chartSamples();
  const x = index => index * 35;
  const y = value => 154 - value / 1.8 * 144;
  const path = data => data.map((value, index) => `${index ? "L" : "M"}${x(index)} ${y(value).toFixed(3)}`).join(" ");
  $("#usageArea").setAttribute("d", `${path(values)} L560 154 L0 154 Z`);
  $("#usageLine").setAttribute("d", path(values));
  $("#usualLine").setAttribute("d", path(CHART_USUAL));
  const current = Math.round(homeKW() * 1000), usual = Math.round(MODEL.usualKW * 1000);
  $("#usageDescription").textContent = `Illustrative history over the last eight hours, with ${current} watts simulated use now and ${usual} watts usual reference. Solid green is simulated use; dashed grey is the usual reference. Earlier samples are presets. ${chartTransitionLabel ? `Current endpoint: ${chartTransitionLabel}.` : ""}`;
  $("#usageChart").setAttribute("aria-label", `Simulated use now ${current} watts; usual reference ${usual} watts`);
  $("#usageTimeLabels").innerHTML = [8, 6, 4, 2, 0].map(hours => `<span>${hours ? chartClock(new Date(Date.now() - hours * 3600000)) : "Now"}</span>`).join("");
  $("#chartPoints").innerHTML = values.map((value, index) => `<circle class="chart-point ${index === 16 ? "current-point" : ""}" cx="${x(index)}" cy="${y(value).toFixed(3)}" r="${index === 16 ? 5 : 8}" tabindex="${index === chartFocusIndex ? 0 : -1}" role="button" data-point="${index}" aria-label="${index === 16 ? "Now" : `${(16 - index) / 2} hours ago`}: ${Math.round(value * 1000)} watts simulated, ${Math.round(CHART_USUAL[index] * 1000)} watts usual"><title>${Math.round(value * 1000)} W simulated · ${Math.round(CHART_USUAL[index] * 1000)} W usual</title></circle>`).join("");
  $("#chartTransition").toggleAttribute("hidden", !chartTransitionLabel);
  $("#chartContext").textContent = chartTransitionLabel ? `Now: ${chartTransitionLabel}. Earlier history stays preset; the endpoint reflects the current simulation. Hover, tap or use arrow keys to compare.` : "Preset samples, not measurements. Hover, tap or focus the chart and use arrow keys to compare.";
  chartReadout(chartFocusIndex);
}
$("#chartPoints").addEventListener("pointerover", event => { if (event.target.dataset.point) chartReadout(Number(event.target.dataset.point)); });
$("#chartPoints").addEventListener("click", event => { if (event.target.dataset.point) { chartFocusIndex = Number(event.target.dataset.point); chartReadout(chartFocusIndex); } });
$("#chartPoints").addEventListener("focusin", event => { if (event.target.dataset.point) { chartFocusIndex = Number(event.target.dataset.point); chartReadout(chartFocusIndex); } });
$("#chartPoints").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  chartFocusIndex = event.key === "Home" ? 0 : event.key === "End" ? 16 : Math.max(0, Math.min(16, chartFocusIndex + (event.key === "ArrowLeft" ? -1 : 1)));
  document.querySelectorAll("[data-point]").forEach(point => point.setAttribute("tabindex", Number(point.dataset.point) === chartFocusIndex ? "0" : "-1"));
  $(`[data-point="${chartFocusIndex}"]`).focus();
});
function renderOutageSummary() {
  const outage = state.mode === "outage";
  $("#outageSummary").hidden = !outage;
  $("#billCard").hidden = outage;
  if (!outage) return;
  const runtime = availableKWh() / homeKW();
  $("#outageRuntime").textContent = `${hoursLabel(runtime)} estimated`;
  const covers = runtime >= state.outageHours;
  $("#outageCoverage").textContent = covers ? `Estimated to cover the ${state.outageHours} h scenario · ${hoursLabel(runtime - state.outageHours)} model margin` : stepDownTimer ? `Checking a lower-load plan for the ${state.outageHours} h scenario…` : `Estimated shortfall: ${hoursLabel(state.outageHours - runtime)} for the ${state.outageHours} h scenario. Keep protected devices on; additional supply would be needed.`;
  $("#outageCoverage").className = covers ? "outage-covered" : "outage-shortfall";
  $("#outageFacts").innerHTML = `<div><dt>Expected outage</dt><dd>${state.outageHours} h</dd></div><div><dt>Battery available</dt><dd>${availableKWh().toFixed(2)} kWh · 82%</dd></div><div><dt>At this level</dt><dd>${Math.round(homeKW() * 1000)} W · Level ${state.level}</dd></div>`;
  $("#outagePowered").textContent = allDevices().filter(isProtected).map(device => device.name).join(" · ") + (state.level === 3 ? " · other active flexible loads at Level 3" : "");
  const paused = allDevices().filter(device => outageCut(device) && device.watts > 0).map(device => device.name);
  $("#outagePaused").textContent = [...paused, "Water heater (deferred)", ...(ports[0].devices[1].level === "Flexible" ? [ports[0].devices[1].name + " (waiting)"] : [])].join(" · ");
}

/* ---------- date and greeting ---------- */
const now = new Date();
const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
$("#todayLabel").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
const hour = now.getHours();
const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
function renderProfile() {
  $("#greeting").textContent = `Good ${partOfDay}, ${firstName()}`;
  $("#avatar").textContent = initials();
  $("#mobileAvatar").textContent = initials();
  $("#profileHome").textContent = profile.home;
  $("#profileRole").textContent = profile.role;
  MODEL.pricePerKWh = plan().price;
  MODEL.budget = profile.budget;
}
renderProfile();

/* ---------- rendering ---------- */
const PRIORITY_BEHAVIOR = {
  Critical: "Keeps power at every level in this simulation.",
  Important: "Keeps power in Saver and during outages in this simulation.",
  Flexible: "Approved standby may pause; other flexible loads pause during long outages."
};
function renderPorts() {
  const groups = deviceView === "ports" ? ports.map((port, index) => ({ name: port.port, indices: [index] })) :
    [...new Set(ports.map(port => port.room))].map(room => ({ name: room, indices: ports.flatMap((port, index) => port.room === room ? [index] : []) }));
  portList.innerHTML = groups.map(group => {
    const entries = group.indices.flatMap(portIndex => ports[portIndex].devices.map((device, deviceIndex) => ({ device, portIndex, deviceIndex })));
    const groupPorts = group.indices.map(index => ports[index]);
    return `<article class="port-card ${entries.length ? "" : "empty-port"}">
      <header class="port-card-header"><div class="port-symbol"><i data-lucide="${deviceView === "rooms" ? "house" : "blocks"}"></i></div><div><span class="port-kicker">${groupPorts.some(port => port.live) ? "LIVE" : "SIMULATED"} · ${deviceView === "rooms" ? "ROOM" : groupPorts[0].status}</span><h3>${escapeHtml(group.name)}</h3><p>${escapeHtml(deviceView === "rooms" ? groupPorts.map(port => port.port).join(" · ") : groupPorts[0].room)} · ${entries.length} ${entries.length === 1 ? "device" : "devices"}</p></div><strong>${entries.reduce((sum, { device }) => sum + deviceDraw(device), 0)} W</strong></header>
      <div class="nested-devices">${entries.length ? entries.map(({ device, portIndex, deviceIndex }) => `
        <div class="nested-device ${deviceDraw(device) === 0 && device.watts > 0 ? "paused-device" : ""}">
          <div class="device-icon"><i data-lucide="${device.icon}"></i></div>
          <div class="nested-device-copy"><h4>${escapeHtml(device.name)}</h4><p>${escapeHtml(deviceDetail(device))}${deviceView === "rooms" ? ` · ${ports[portIndex].port}` : ""}</p><small class="device-behavior">${PRIORITY_BEHAVIOR[device.level]}</small></div>
          <span class="nested-watts">${deviceDraw(device)} W</span>
          <label><span class="sr-only">Priority for ${escapeHtml(device.name)} on ${ports[portIndex].port}</span><select class="criticality-select" data-port="${portIndex}" data-device="${deviceIndex}" aria-label="Priority for ${escapeHtml(device.name)}">${["Critical", "Important", "Flexible"].map(level => `<option ${level === device.level ? "selected" : ""}>${level}</option>`).join("")}</select></label>
          <button class="edit-device" data-edit-port="${portIndex}" data-edit-device="${deviceIndex}" aria-label="Edit ${escapeHtml(device.name)}"><i data-lucide="pencil"></i></button>
        </div>`).join("") : `<p class="empty-message">No devices assigned yet.</p>`}</div>
      ${group.indices.map(index => `<button class="add-device-to-port" data-add-port="${index}"><i data-lucide="plus"></i>Add device to ${ports[index].port}</button>`).join("")}
    </article>`;
  }).join("");
}
document.querySelectorAll("[data-device-view]").forEach(button => button.addEventListener("click", () => {
  deviceView = button.dataset.deviceView;
  document.querySelectorAll("[data-device-view]").forEach(item => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  renderPorts(); if (window.lucide) lucide.createIcons();
}));

function renderDeviceStrip() {
  const picks = [ports[0].devices[0], ports[1].devices[0], ports[1].devices[1]].filter(Boolean);
  $("#deviceStrip").innerHTML = picks.map(device => {
    const draw = deviceDraw(device);
    const paused = draw === 0 && device.watts > 0;
    return `
    <article class="device-card ${device.level === "Critical" ? "critical" : ""} ${paused ? "paused-device" : ""}">
      <div class="device-icon"><i data-lucide="${device.icon}"></i></div>
      <div class="device-info"><div><h3>${escapeHtml(device.name)}</h3><span class="criticality ${LEVEL_CLASS[device.level]}">${device.level === "Critical" ? '<i data-lucide="shield-check"></i> ' : ""}${device.level}</span></div><p>${deviceDetail(device)}</p></div>
      <strong>${draw} <small>W</small></strong>
    </article>`;
  }).join("");
}

// Future potential is separate from instantaneous draw and preset four-week history.
function priceSuggestions() {
  const estimate = WattwiseEstimates.standby(allDevices(), plan().price, MODEL.standbyHoursPerDay);
  const { eligibleWatts: watts, annualKWh, annualSaving } = estimate;
  suggestions[0].watts = `${watts} W`;
  $("#quickInsightWatts").textContent = `${watts} W`;
  $("#quickInsightTitle").textContent = `Avoid about ${Math.round(annualKWh)} kWh a year of standby use`;
  suggestions[0].savings = `${WattwiseEstimates.dollars(annualSaving)} potential / year`;
  $("#quickInsightSaving").textContent = WattwiseEstimates.dollars(annualSaving);
  $("#standbyBreakdown").innerHTML = estimate.rows.map(row => `<div><span>${escapeHtml(row.name)}<small>${row.watts} W preset standby · ${row.eligible ? `${row.annualKWh.toFixed(1)} kWh / year` : "protected · excluded"}</small></span><strong>${WattwiseEstimates.dollars(row.annualSaving)}<small>potential / year</small></strong></div>`).join("");
  $("#standbyEstimateBasis").textContent = `Eligible total: ${annualKWh.toFixed(1)} kWh / year × ${Math.round(plan().price * 1000) / 10}¢/kWh = ${WattwiseEstimates.dollars(annualSaving)} / year. Assumes ${MODEL.standbyHoursPerDay} standby hours every day for 365 days. Approval pauses power now; it does not earn a year's saving immediately.`;
  const dishEstimate = WattwiseEstimates.dishwasher({ peakDiff: plan().peakDiff, eligible: ports[0].devices[1].level === "Flexible" });
  const dish = suggestions[1];
  dish.watts = `${WattwiseEstimates.ASSUMPTIONS.dishwasherKWhPerRun} kWh per run`;
  dish.body = plan().peakDiff > 0
    ? `Peak-to-off-peak comparison: ${WattwiseEstimates.ASSUMPTIONS.dishwasherRunsPerMonth} runs × ${WattwiseEstimates.ASSUMPTIONS.dishwasherKWhPerRun} kWh × the plan's price difference. This preset is already scheduled for 10:30 PM, so confirming it adds $0.00.`
    : "This plan has no time-of-use price difference. Moving a run later has $0.00 bill-saving potential. This preset is already scheduled for 10:30 PM.";
  dish.savings = `${WattwiseEstimates.dollars(dishEstimate.monthlyPotential)} potential / month`;
  $("#dishwasherEstimate").textContent = `${WattwiseEstimates.dollars(dishEstimate.monthlyPotential)} / month potential for shifting ${WattwiseEstimates.ASSUMPTIONS.dishwasherRunsPerMonth} × ${WattwiseEstimates.ASSUMPTIONS.dishwasherKWhPerRun} kWh from peak to off-peak at ${Math.round(plan().peakDiff * 100)}¢/kWh difference. Current preset: already off-peak; ${WattwiseEstimates.dollars(dishEstimate.incrementalMonthlySaving)} additional saving. ${ports[0].devices[1].level === "Flexible" ? "" : "Dishwasher is protected; excluded from changes."}`;
}

function renderSuggestions() {
  priceSuggestions();
  suggestionList.innerHTML = suggestions.map((item, index) => `
    <article class="suggestion-card">
      <div class="suggestion-top"><div class="device-icon"><i data-lucide="${item.icon}"></i></div><span class="impact-pill">${item.applied ? "Applied" : item.impact}</span></div>
      <h3>${item.title}</h3><p>${item.body}</p>
      <div class="suggestion-stats"><span>Impact<strong>${item.watts}</strong></span><span>Estimated saving<strong>${item.savings}</strong></span></div>
      <p class="suggestion-state">${item.applied ? index === 0 ? "Suggestion active · restore manually when needed" : "Tonight’s schedule confirmed · cancel anytime" : "Review devices and recovery before making a change"}</p><button class="button suggestion-apply" data-suggestion="${index}">${item.applied ? index === 0 ? "Restore now" : "Cancel schedule change" : "Review & apply"}</button>
    </article>`).join("");
  const open = suggestions.filter(item => !item.applied).length;
  $("#insightCountBadge").textContent = open;
  $("#insightCountBadge").hidden = open === 0;
  $("#insightCountLabel").textContent = open ? `${open} READY FOR REVIEW` : "ALL SUGGESTIONS APPLIED";

  const quick = $("#applySuggestion");
  quick.disabled = false;
  const pausedW = allDevices().filter(isStandbyPaused).reduce((sum, d) => sum + d.watts, 0);
  quick.textContent = suggestions[0].applied ? "Restore now" : "Review standby pause";
  $("#quickInsightText").textContent = suggestions[0].applied ? `Suggestion active for ${pausedW} W of eligible standby. Restore now removes this pause; an outage plan may still keep Flexible devices paused.` : "Review the eligible standby devices before pausing them. You can restore power here at any time; Critical and Important devices stay powered.";
  $("#quickInsightLabel").textContent = suggestions[0].applied ? "STANDBY PAUSE ACTIVE" : "NEW SUGGESTION";
}

function renderStatus() {
  const outage = state.mode === "outage";
  const kw = homeKW();
  const runtime = outage ? availableKWh() / kw : availableKWh() / protectedKW();
  const protectedRuntime = availableKWh() / protectedKW();

  $("#livePower").textContent = kwLabel(kw);
  const diff = MODEL.usualKW - kw, pct = Math.round(diff / MODEL.usualKW * 100);
  const trend = $("#trendPill");
  trend.className = `trend ${outage ? "outage" : pct > 0 ? "down" : "flat"}`;
  $("#trendValue").textContent = outage ? "On battery" : pct > 0 ? `${pct}%` : "0%";
  $("#powerNote").textContent = outage
    ? state.level >= 4 ? `Only Critical + Important devices are powered · ${Math.round(protectedKW() * 1000)} W` : "On battery · standby cut, flexible loads waiting"
    : pct > 0 ? `${diff.toFixed(1)} kW lower than your usual ${weekday}` : `About the same as your usual ${weekday}`;

  $("#runtimeLabel").textContent = outage ? "Runtime at this level" : "Protected runtime";
  $("#runtimeValue").textContent = hoursLabel(runtime);
  const protectedLoads = allDevices().filter(isProtected).length;
  const deferred = allDevices().filter(d => d.level === "Flexible" && d.watts > 0 && deviceDraw(d) === 0).length + (state.level >= 2 ? 1 : 0);
  $("#protectedCount").textContent = `${protectedLoads} ${protectedLoads === 1 ? "load" : "loads"}`;
  $("#deferredCount").textContent = `${deferred} flexible`;
  $("#batteryTitle").textContent = outage ? `Simulated battery plan: Level ${state.level}` : "Power plan agreed";
  $("#batteryText").textContent = outage
    ? `Devices are sharing ${Math.round(kw * 1000)} W of battery power for about ${hoursLabel(runtime)}. Expected outage: ${state.outageHours} h.`
    : `Devices are sharing what they need, what can wait, and which loads must remain protected. If the grid drops, protected devices last about ${hoursLabel(protectedRuntime)}.`;
  $(".battery-status").classList.toggle("discharging", outage);

  $("#gridDot").classList.toggle("outage", outage);
  $("#gridTitle").textContent = outage ? "Grid outage" : "Grid connected";
  $("#gridSubtitle").textContent = outage ? `On battery · ${hoursLabel(runtime)} left` : "Home is protected";
  $("#livePill").classList.toggle("on-battery", outage);
  $("#livePillText").textContent = outage ? "Simulation · battery" : "Simulation";
  renderUsageChart();
  renderOutageSummary();

  if (outage) $("#modeDescription").textContent = `Grid power is unavailable. Expected outage: ${state.outageHours} hours. Critical and important devices always stay on.`;
  renderLadder();
  $("#portCountBadge").textContent = ports.length;
  $("#portCountLabel").textContent = `${ports.length} REGISTERED PORTS`;
  $("#assistantHello").innerHTML = outage
    ? `Hi, ${escapeHtml(firstName())}. The grid is down. At Level ${state.level} your batteries last about <strong>${hoursLabel(runtime)}</strong>.`
    : pct > 0 ? `${partOfDay === "morning" ? "Morning" : "Hi"}, ${escapeHtml(firstName())}. Your home is using <strong>${pct}% less</strong> than usual.` : `Hi, ${escapeHtml(firstName())}. Your home is using about as much as usual.`;
}

function renderLadder() {
  const active = state.mode === "normal" ? [0] : state.mode === "saver" ? [1, 2] : [state.level];
  const top = Math.max(...active);
  document.querySelectorAll("#ladderStrip li").forEach(li => {
    const level = Number(li.dataset.level);
    li.className = active.includes(level) ? `current ${level >= 3 ? "battery" : ""}` : level < top ? "passed" : "";
  });
  const l3 = hoursLabel(runtimeAt(3)), l4 = hoursLabel(runtimeAt(4));
  let note;
  if (state.mode === "normal") note = "<strong>Level 0.</strong> Everything runs as you use it. Wattwise is only watching.";
  else if (state.mode === "saver") note = "<strong>Levels 1 and 2, every day.</strong> Approved standby loads are cut and loads that can wait, like the water heater, run at cheaper hours.";
  else if (state.level === 3) note = `<strong>Level 3, on battery.</strong> At this level the battery lasts ${l3}. Checking it against the expected ${state.outageHours} h outage…`;
  else note = `<strong>Level 4.</strong> Level 3 would last ${l3}, short of the expected ${state.outageHours} h, so only critical and important devices stay on: <strong>${l4}</strong>.`;
  if (state.mode === "outage" && state.level === 3 && runtimeAt(3) >= state.outageHours && !stepDownTimer) {
    note = `<strong>Level 3 is enough.</strong> It lasts ${l3}, longer than the expected ${state.outageHours} h outage, so Wattwise stops here and comfort loads stay on.`;
  }
  $("#ladderNote").innerHTML = note;
}

function renderHistory() {
  const weeks = historyPeriod === "weeks";
  const rows = weeks ? HISTORY.map(w => ({ label: w.week, last: w.last, now: w.now })) : DAILY.map(d => ({ label: d.day, last: d.last, now: d.now }));
  const max = Math.max(...rows.map(r => Math.max(r.last, r.now))) * 1.15;
  $("#weeklyBars").innerHTML = rows.map(r => `<div><span style="height:${(r.last / max * 100).toFixed(1)}%" data-value="${r.last}" title="${r.label}, last month: ${r.last} kWh"></span><b style="height:${(r.now / max * 100).toFixed(1)}%" data-value="${r.now}" title="${r.label}, this month: ${r.now} kWh"></b><small>${r.label}</small></div>`).join("");
  const last = rows.reduce((sum, r) => sum + r.last, 0), cur = rows.reduce((sum, r) => sum + r.now, 0);
  const saved = Math.round((last - cur) * 10) / 10;
  const pct = Math.round((last - cur) / last * 100);
  const share = saved / savedKWh;
  const cents = value => Math.round(value * 100) / 100;
  const usingLess = cents(saved * MODEL.pricePerKWh), betterTiming = cents(shiftSavings() * share);
  const moneySaved = usingLess + betterTiming;
  const fridgeKWhPerDay = ports[0].devices[0].watts * 24 / 1000;
  $("#historyEyebrow").textContent = weeks ? "LAST 4 WEEKS" : "LAST 7 DAYS";
  $("#historyPct").textContent = `${pct}%`;
  $("#historyLead").textContent = `You’ve used ${pct}% less energy than the same ${weeks ? "weeks" : "days"} last month: ${Math.round(cur)} kWh instead of ${Math.round(last)} kWh.`;
  $("#historySaved").innerHTML = `${saved} <small>kWh</small>`;
  $("#historyFridge").textContent = `Enough to run your refrigerator for about ${Math.max(1, Math.round(saved / fridgeKWhPerDay))} days.`;
  $("#legendLast").textContent = weeks ? "Same week last month" : "Same day last month";
  $("#legendUnit").textContent = weeks ? "kWh per week" : "kWh per day";
  const hours = Math.round(SOURCES.reduce((sum, src) => sum + src.hours, 0) * share);
  $("#historyKpis").innerHTML = `
    <article><small>Money saved</small><strong>${money(moneySaved)}</strong><span>${money(usingLess)} from using less, ${money(betterTiming)} from better timing</span></article>
    <article><small>Standby time avoided</small><strong>${hours.toLocaleString("en-US")} h</strong><span>Device-hours that standby loads spent switched off</span></article>
    <article><small>Critical devices powered</small><strong>100%</strong><span>${weeks ? "Including the 2 h 10 m outage on Oct 4" : "No outages in the last 7 days"}</span></article>`;
  $("#savingsSources").innerHTML = SOURCES.map(src => `<li><div class="device-icon"><i data-lucide="${src.icon}"></i></div><div><strong>${src.name}</strong><small>${src.how}</small><div class="source-bar"><i style="width:${(src.kwh / SOURCES[0].kwh * 100).toFixed(0)}%"></i></div></div><div class="source-value">${src.kwh} kWh<small><br>${money(src.kwh * MODEL.pricePerKWh)}</small></div></li>`).join("");
  $("#shiftRow").innerHTML = plan().peakDiff > 0
    ? `<strong>${SHIFT.kwh} kWh moved out of the 4 to 9 PM peak.</strong> ${SHIFT.what} ran later, at about ${Math.round(plan().peakDiff * 100)}¢/kWh less: ${money(shiftSavings())} saved without using less.`
    : `<strong>${SHIFT.kwh} kWh moved out of the 4 to 9 PM peak.</strong> ${SHIFT.what} ran later. Your plan charges one price all day, so this eased the grid rather than your bill.`;
  renderActivity();
}

function renderActivity() {
  const items = [...liveActivity, ...ACTIVITY_SEED].filter(item => activityFilter === "all" || item.type === activityFilter);
  const label = { wifi: "Wi-Fi", line: "Power line", app: "In the app" };
  $("#activityLog").innerHTML = items.length ? items.map(item => `<li data-type="${item.type}" class="${item.live ? "live" : ""}"><div class="log-icon"><i data-lucide="${item.icon}"></i></div><div><div class="log-meta"><span>${item.when}</span><span class="channel ${item.channel}">${label[item.channel]}</span></div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(typeof item.detail === "function" ? item.detail() : item.detail)}</p></div></li>`).join("") : `<li class="activity-empty">Nothing here yet.</li>`;
  if (window.lucide) lucide.createIcons();
}

function renderBill() {
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const soFarKWh = MODEL.dailyKWh * day;
  const projected = MODEL.dailyKWh * daysInMonth * MODEL.pricePerKWh;
  const saved = (savedPerDay * MODEL.pricePerKWh + shiftSavings() / (HISTORY.length * 7)) * day;
  $("#billProjected").textContent = money(projected);
  $("#billBudget").textContent = `of $${MODEL.budget} budget`;
  $("#billProgress").style.width = `${Math.min(100, Math.round(projected / MODEL.budget * 100))}%`;
  $("#billSoFarLabel").textContent = `So far, ${Math.round(soFarKWh)} kWh`;
  $("#billSoFar").textContent = money(soFarKWh * MODEL.pricePerKWh);
  $("#billSaved").textContent = money(saved);
  const left = daysInMonth - day;
  $("#billDaysLeft").textContent = `${left} ${left === 1 ? "day" : "days"}`;
}

function render() {
  renderProfile();
  renderBill();
  renderPorts();
  renderDeviceStrip();
  renderSuggestions();
  renderStatus();
  renderHistory();
  renderNotifications();
  renderGuide();
  if (window.lucide) lucide.createIcons();
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/* ---------- toast ---------- */
const shell = $(".app-shell");
const panel = $(".assistant-panel");
const scrim = $(".scrim");
const toast = $(".toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

/* ---------- assistant panel ---------- */
function openAssistant(seed) {
  shell.classList.add("assistant-visible");
  panel.setAttribute("aria-hidden", "false");
  if (innerWidth <= 1100) scrim.hidden = false;
  if (seed) {
    $("#chatInput").value = seed;
    $("#chatInput").focus();
  }
}

function closeAssistant() {
  shell.classList.remove("assistant-visible");
  panel.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
}

document.querySelectorAll(".assistant-open").forEach(button => button.addEventListener("click", () => openAssistant()));
$(".assistant-close").addEventListener("click", closeAssistant);
scrim.addEventListener("click", closeAssistant);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) closeAssistant(); });
document.querySelectorAll(".ask-assistant").forEach(button => button.addEventListener("click", () => openAssistant("Why is it safe to pause these devices?")));

/* ---------- navigation ---------- */
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

/* ---------- modes ---------- */
const modeCopy = {
  normal: ["Normal", "Everything runs normally. Wattwise still watches for unusual or wasteful use."],
  saver: ["Smart saver", "Approved standby loads pause automatically, and loads that can wait run at cheaper hours."],
  outage: ["Backup protection", "Grid power is unavailable. Critical and important devices stay on; flexible loads are paused."]
};

function setMode(mode, force) {
  if (mode === state.mode && !force) return;
  const wasOutage = state.mode === "outage";
  clearTimeout(stepDownTimer); stepDownTimer = null;
  state.mode = mode;
  chartTransitionLabel = mode === "outage" ? "Outage started" : wasOutage ? "Grid restored" : mode === "saver" ? "Saver selected" : "Normal selected";
  state.level = mode === "normal" ? 0 : mode === "saver" ? 2 : 3;
  if (mode === "outage") logEvent("outage", "zap-off", "Grid outage started", `Expected to last ${state.outageHours} h. Level 3 on battery: about ${hoursLabel(runtimeAt(3))} at this level.`);
  else if (wasOutage) logEvent("outage", "plug-zap", "Grid power restored", "Simulation: outage pauses removed. Active standby suggestions stay paused until Restore now; deferred schedules remain in place.");
  else logEvent("savings", mode === "saver" ? "leaf" : "layout-dashboard", mode === "saver" ? "Smart saver turned on" : "Normal mode", mode === "saver" ? "Standby loads pause automatically; loads that can wait run at cheaper hours." : "Everything runs as you use it. Wattwise keeps watching.", "app");
  if (mode === "outage") {
    stepDownTimer = setTimeout(() => {
      stepDownTimer = null;
      if (state.mode !== "outage") return;
      if (runtimeAt(3) < state.outageHours) {
        state.level = 4;
        chartTransitionLabel = "Protected loads only";
        logEvent("outage", "shield-check", "Stepped down to Level 4, protected loads only", `Level 3 would last ${hoursLabel(runtimeAt(3))}, short of the expected ${state.outageHours} h. Protected devices now last about ${hoursLabel(runtimeAt(4))}.`);
        render();
        showToast(`Level 3 would last ${hoursLabel(runtimeAt(3))}. Stepping down to protected devices: ${hoursLabel(runtimeAt(4))}`);
      } else {
        logEvent("outage", "check", "Held at Level 3", `It lasts ${hoursLabel(runtimeAt(3))}, longer than the expected ${state.outageHours} h, so comfort loads stayed on.`);
        render();
        showToast(`Level 3 lasts ${hoursLabel(runtimeAt(3))}, longer than the ${state.outageHours} h outage. Holding here.`);
      }
    }, 2600);
  }
  document.querySelectorAll("[data-mode]").forEach(item => item.classList.toggle("active", item.dataset.mode === mode));
  $("#modeTitle").textContent = modeCopy[mode][0];
  $("#modeDescription").textContent = modeCopy[mode][1];
  $("#modeBanner").dataset.state = mode;
  render();
  showToast(mode === "outage" ? `Grid down · Level 3, on battery for about ${hoursLabel(runtimeAt(3))}` : `${modeCopy[mode][0]} mode is active`);
}
document.querySelectorAll("[data-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.mode)));

/* ---------- reviewable and reversible suggestions ---------- */
const eligibleStandby = () => allDevices().filter(device => device.standby && device.level === "Flexible");
const suggestionDialog = $("#suggestionDialog");
let pendingSuggestion = null;
let dishwasherPreviousDetail = null;
function applySuggestion(index) {
  const item = suggestions[index];
  if (item.applied) { restoreSuggestion(index); return; }
  pendingSuggestion = index;
  priceSuggestions();
  const targets = index === 0 ? allDevices().filter(device => device.standby) : [ports[0].devices[1]];
  const eligible = index === 0 ? eligibleStandby() : targets.filter(device => device.level === "Flexible");
  $("#suggestionReviewTitle").textContent = item.title;
  $("#suggestionReviewDevices").innerHTML = targets.map(device => `<li><span><strong>${escapeHtml(device.name)}</strong><small>${escapeHtml(device.level)} · ${device.watts} W preset draw</small></span><b class="${eligible.includes(device) ? "eligible" : "excluded"}">${eligible.includes(device) ? index === 0 ? "Will pause" : "Confirm schedule" : "Protected · unchanged"}</b></li>`).join("");
  $("#suggestionReviewFacts").innerHTML = index === 0
    ? `<div><dt>Duration</dt><dd>Until you select Restore now</dd></div><div><dt>Restore</dt><dd>Available here and in Insights</dd></div><div><dt>Eligible standby</dt><dd>${eligible.reduce((sum, device) => sum + device.watts, 0)} W · ${eligible.length} devices</dd></div>`
    : `<div><dt>Current schedule</dt><dd>${escapeHtml(targets[0].detail)}</dd></div><div><dt>Requested schedule</dt><dd>10:30 PM tonight · after 9 PM peak</dd></div><div><dt>Cancel</dt><dd>Return to the previous schedule from Insights</dd></div>`;
  $("#suggestionReviewNote").textContent = eligible.length ? index === 0 ? "Only the Flexible devices listed above will pause in this simulation. Restore now removes the suggestion pause. An active outage plan can still keep these devices paused until the simulated grid returns." : "This confirms tonight’s 10:30 PM schedule in the simulation. If already scheduled then, it does not produce additional savings. Critical and Important devices are unchanged." : "No eligible Flexible devices. Protected devices cannot be paused or rescheduled by this suggestion.";
  $("#suggestionReviewEstimate").textContent = index === 0 ? `Estimate: ${item.savings}, assuming ${MODEL.standbyHoursPerDay} standby hours every day at the illustrative ${Math.round(plan().price * 1000) / 10}¢/kWh rate. This is not a measured result.` : $("#dishwasherEstimate").textContent + " No wash cycle is started.";
  $("#confirmSuggestion").disabled = !eligible.length;
  suggestionDialog.showModal(); $("#cancelSuggestionReview").focus();
}
function restoreSuggestion(index) {
  const item = suggestions[index];
  item.applied = false;
  if (index === 1 && dishwasherPreviousDetail !== null) { ports[0].devices[1].detail = dishwasherPreviousDetail; dishwasherPreviousDetail = null; }
  const stillPaused = index === 0 && eligibleStandby().some(outageCut);
  chartTransitionLabel = index === 0 ? "Suggestion restored" : "Schedule cancelled";
  logEvent("savings", "rotate-ccw", index === 0 ? "Simulated standby pause removed" : "Simulated schedule change cancelled", stillPaused ? "Outage protection still keeps Flexible standby devices paused. Their previous draw returns when the simulated grid is restored." : "Previous simulated device state restored.", "app");
  render(); showToast(stillPaused ? "Suggestion removed · outage plan still pauses these devices" : index === 0 ? "Simulated standby power restored" : "Previous schedule restored");
}
$("#closeSuggestionReview").addEventListener("click", () => suggestionDialog.close());
$("#cancelSuggestionReview").addEventListener("click", () => suggestionDialog.close());
suggestionDialog.addEventListener("close", () => { pendingSuggestion = null; });
$("#suggestionReviewForm").addEventListener("submit", event => {
  event.preventDefault();
  const index = pendingSuggestion;
  if (index === null) return;
  const eligible = index === 0 ? eligibleStandby() : [ports[0].devices[1]].filter(device => device.level === "Flexible");
  if (!eligible.length) { applySuggestion(index); return; }
  const item = suggestions[index];
  item.applied = true;
  if (index === 1) { dishwasherPreviousDetail = ports[0].devices[1].detail; ports[0].devices[1].detail = "Confirmed for 10:30 PM tonight · simulated"; }
  const watts = eligible.reduce((sum, device) => sum + device.watts, 0);
  chartTransitionLabel = index === 0 ? "Standby pause applied" : "Schedule confirmed";
  logEvent("savings", item.icon, index === 0 ? "Simulated standby pause approved" : "Simulated off-peak schedule confirmed", index === 0 ? `${eligible.map(device => device.name).join(" and ")} · ${watts} W eligible. Restore now removes this suggestion pause.` : "Tonight’s 10:30 PM schedule confirmed; cancel restores the prior schedule. No additional savings assumed for an already off-peak schedule.", "app");
  suggestionDialog.close(); render(); showToast(index === 0 ? `Simulation: ${eligible.length} standby devices paused` : "Simulation: tonight’s schedule confirmed");
});
$("#applySuggestion").addEventListener("click", () => applySuggestion(0));
suggestionList.addEventListener("click", event => {
  const button = event.target.closest(".suggestion-apply");
  if (button) applySuggestion(Number(button.dataset.suggestion));
});

/* ---------- criticality, with a confirmation before removing protection ---------- */
const confirmDialog = $("#confirmDialog");
let pendingChange = null;

function setLevel(portIndex, deviceIndex, level) {
  const port = ports[portIndex];
  const device = port.devices[deviceIndex];
  const before = device.level;
  device.level = level;
  logEvent("protection", level === "Critical" ? "shield-check" : "shield-off", `${device.name} set to ${level}`, before === "Critical" ? level === "Important" ? "Priority changed after confirmation; remains powered in the simulation." : "Flexible priority approved after confirmation." : level === "Critical" ? "Kept powered at every simulated level." : `Changed from ${before}.`, "app");
  render();
  showToast(`${device.name} on ${port.port} set to ${level.toLowerCase()}`);
}

portList.addEventListener("change", event => {
  if (!event.target.matches("select")) return;
  const portIndex = Number(event.target.dataset.port);
  const deviceIndex = Number(event.target.dataset.device);
  const device = ports[portIndex].devices[deviceIndex];
  const level = event.target.value;
  if (device.level === "Critical" && level !== "Critical") {
    pendingChange = { portIndex, deviceIndex, level };
    $("#confirmTitle").textContent = `Change priority for ${device.name}?`;
    $("#confirmOk").textContent = `Change to ${level}`;
    $("#confirmText").textContent = level === "Flexible" ? `${device.name} may be paused in the simulation’s outage plan or an approved standby suggestion. Keep medical and safety devices protected.` : `${device.name} will be Important and remain powered during simulated outages. This changes its label, not its current protection.`;
    event.target.value = device.level; // stays Critical until confirmed
    confirmDialog.showModal();
    $("#confirmCancel").focus();
    return;
  }
  setLevel(portIndex, deviceIndex, level);
});

$("#confirmCancel").addEventListener("click", () => confirmDialog.close());
$("#confirmForm").addEventListener("submit", event => {
  event.preventDefault();
  const change = pendingChange;
  confirmDialog.close();
  if (change) setLevel(change.portIndex, change.deviceIndex, change.level);
});
confirmDialog.addEventListener("close", () => { pendingChange = null; });

/* ---------- add and edit devices ---------- */
const deviceDialog = $("#deviceDialog");
const deviceForm = $("#deviceForm");
let activePortIndex = null;
let activeDeviceIndex = null;

portList.addEventListener("click", event => {
  const button = event.target.closest("[data-add-port], [data-edit-port]");
  if (!button) return;
  activePortIndex = Number(button.dataset.addPort ?? button.dataset.editPort);
  activeDeviceIndex = button.dataset.editDevice === undefined ? null : Number(button.dataset.editDevice);
  const port = ports[activePortIndex];
  const device = activeDeviceIndex === null ? null : port.devices[activeDeviceIndex];
  $("#dialogPortName").textContent = port.port;
  $("#deviceDialogTitle").textContent = device ? "Edit device" : "Add a device";
  $("#deviceName").value = device?.name || "";
  $("#deviceCriticality").value = device?.level || "Flexible";
  deviceDialog.showModal();
  $("#deviceName").focus();
});

$("#closeDeviceDialog").addEventListener("click", () => deviceDialog.close());
$("#cancelDeviceDialog").addEventListener("click", () => deviceDialog.close());
deviceDialog.addEventListener("close", () => { activePortIndex = null; activeDeviceIndex = null; });

deviceForm.addEventListener("submit", event => {
  event.preventDefault();
  if (activePortIndex === null) return;
  const name = $("#deviceName").value.trim();
  if (!name) return;
  const port = ports[activePortIndex];
  const level = $("#deviceCriticality").value;
  const editing = activeDeviceIndex !== null;
  if (editing) {
    // Keep the measured wattage, icon and status; only the name and criticality change here.
    const device = port.devices[activeDeviceIndex];
    const removingProtection = device.level === "Critical" && level !== "Critical";
    const change = { portIndex: activePortIndex, deviceIndex: activeDeviceIndex, level };
    device.name = name;
    if (!removingProtection) device.level = level;
    deviceDialog.close();
    render();
    if (removingProtection) {
      pendingChange = change;
      $("#confirmTitle").textContent = `Change priority for ${device.name}?`;
    $("#confirmOk").textContent = `Change to ${level}`;
      $("#confirmText").textContent = level === "Flexible" ? `${device.name} may be paused in the simulation’s outage plan or an approved standby suggestion. Keep medical and safety devices protected.` : `${device.name} will be Important and remain powered during simulated outages. This changes its label, not its current protection.`;
      confirmDialog.showModal();
      $("#confirmCancel").focus();
    } else {
      showToast(`${name} updated on ${port.port}`);
    }
    return;
  } else {
    port.devices.push({ name, level, detail: "Newly assigned · measuring", icon: "plug-zap", watts: 0 });
    if (port.status === "Ready") port.status = "Online";
  }
  deviceDialog.close();
  render();
  showToast(`${name} ${editing ? "updated on" : "added to"} ${port.port}`);
});

$("#registerPort").addEventListener("click", () => {
  const letter = String.fromCharCode(65 + ports.length);
  ports.push({ port: `Port ${letter}`, room: "New room", status: "Ready", devices: [] });
  render();
  showToast(`Port ${letter} paired and ready for devices`);
});

/* ---------- smart discovery scan (simulated) ---------- */
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
    logEvent("savings", "scan-search", "Home scan finished", "3 loads identified: 2 can respond automatically, 1 is inferred only and never switched remotely.", "app");
  }, 2650);
});

document.querySelector(".ask-discovery").addEventListener("click", () => {
  openAssistant("How did Wattwise identify these devices?");
});

/* ---------- assistant answers, computed from the same state ---------- */
function answerFor(text) {
  const q = text.toLowerCase();
  const runtime = hoursLabel(availableKWh() / protectedKW());
  const protectedNames = allDevices().filter(isProtected).map(d => d.name);
  const list = names => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "nothing yet";
  if (q.includes("identify") || q.includes("discover") || q.includes("scan")) {
    return "Wattwise combines direct discovery for connected plugs with local power-signature matching. The medical cooler and TV report that they can be controlled. The bedside lamp only matches a measured switching pattern, so Wattwise labels it inferred and never claims it can switch it remotely.";
  }
  if (q.includes("backup") || q.includes("how long") || q.includes("last")) {
    return `Your batteries hold about ${availableKWh().toFixed(1)} kWh. On battery at Level 3 (standby cut, flexible loads waiting) the home lasts about ${hoursLabel(runtimeAt(3))}. At Level 4, only ${list(protectedNames)} (${Math.round(protectedKW() * 1000)} W), it lasts about ${runtime}. ${state.mode === "outage" ? `You are at Level ${state.level} now.` : "I step down only if Level 3 would not last the expected outage."}`;
  }
  if (q.includes("critical") || q.includes("protect")) {
    const critical = allDevices().filter(d => d.level === "Critical").map(d => d.name);
    const important = allDevices().filter(d => d.level === "Important").map(d => d.name);
    return `Critical: ${list(critical)}. Wattwise never interrupts these. Important: ${list(important)}. These stay on in Saver mode and during outages, and I will always ask before changing them.`;
  }
  if (q.includes("safe") || q.includes("turn off") || q.includes("pause")) {
    return standbyPaused()
      ? "Your TV and game console are already paused, saving 21 W. Everything else that is still on is marked Critical or Important, so I would leave it alone."
      : `You can safely pause the living room TV and game console. They have been idle for over 3 hours and are marked Flexible. That saves 21 W, about $59 a year. I will leave ${list(protectedNames)} untouched.`;
  }
  if (q.includes("save") || q.includes("bill") || q.includes("money")) {
    return `This month Wattwise has saved you ${$("#billSaved").textContent}, from pausing standby devices and shifting flexible loads out of the 4 to 9 PM peak. Prices are based on your ${plan().label} plan, about ${Math.round(plan().price * 1000) / 10}¢ per kWh.`;
  }
  return "Based on your current home data, I would start with the 21 W of flexible standby use. Your critical devices remain protected, and I will always ask before changing an Important device.";
}

function addMessage(text, type) {
  const message = document.createElement("div");
  message.className = `message ${type}-message`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.append(paragraph);
  $("#chatLog").append(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

function answerAssistant(text) {
  const reply = answerFor(text);
  window.setTimeout(() => addMessage(reply, "assistant"), 450);
}

$("#chatForm").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  addMessage(text, "user");
  input.value = "";
  answerAssistant(text);
});

$(".suggested-prompts").addEventListener("click", event => {
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

/* ---------- profile and settings ---------- */
const settingsDialog = $("#settingsDialog");
function openSettings() {
  $("#settingName").value = profile.name;
  $("#settingHome").value = profile.home;
  $("#settingRole").value = profile.role;
  $("#settingBudget").value = profile.budget;
  $("#settingPlan").value = profile.plan;
  $("#planNote").textContent = plan().note;
  settingsDialog.showModal();
  $("#settingName").focus();
}
$("#profileButton").addEventListener("click", openSettings);
$("#mobileAvatar").addEventListener("click", openSettings);
$("#closeSettings").addEventListener("click", () => settingsDialog.close());
$("#settingPlan").addEventListener("change", event => { $("#planNote").textContent = PLANS[event.target.value].note; });
$("#settingsForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("#settingName").value.trim();
  const home = $("#settingHome").value.trim();
  const budget = Math.round(Number($("#settingBudget").value));
  if (!name || !home || !(budget >= 20)) return;
  profile = { name, home, role: $("#settingRole").value, budget, plan: $("#settingPlan").value };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(profile)); } catch (error) { /* not saved across reloads */ }
  settingsDialog.close();
  render();
  showToast("Settings saved");
});
$("#resetDemo").addEventListener("click", () => {
  try { localStorage.removeItem(STORE_KEY); } catch (error) { /* nothing stored */ }
  location.reload();
});

/* ---------- grid and backup status ---------- */
const gridDialog = $("#gridDialog");
function openGridDialog() {
  const outage = state.mode === "outage";
  const runtime = hoursLabel(availableKWh() / protectedKW());
  $("#gridDialogTitle").textContent = outage ? "Grid outage" : "Grid connected";
  const facts = [
    ["Grid", outage ? "Unavailable, home is on battery" : "Connected"],
    ["Battery charge", `${Math.round(MODEL.charge * 100)}% · ${availableKWh().toFixed(1)} kWh usable`],
    ["Protected devices", `${allDevices().filter(isProtected).length} devices · ${Math.round(protectedKW() * 1000)} W`],
    ["Protected runtime", runtime],
    ["Plan", plan().label]
  ];
  $("#gridFacts").innerHTML = facts.map(([k, v]) => `<div><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  $("#gridDialogAction").textContent = outage ? "Restore simulated grid" : "Simulate an outage";
  $("#outagePicker").hidden = outage;
  $("#outageHours").value = String(state.outageHours);
  gridDialog.showModal();
}
$("#gridCard").addEventListener("click", openGridDialog);
$("#outageDetails").addEventListener("click", openGridDialog);
$("#closeGridDialog").addEventListener("click", () => gridDialog.close());
$("#gridDialogCancel").addEventListener("click", () => gridDialog.close());
$("#gridForm").addEventListener("submit", event => {
  event.preventDefault();
  gridDialog.close();
  if (state.mode !== "outage") state.outageHours = Number($("#outageHours").value);
  setMode(state.mode === "outage" ? "saver" : "outage");
});

/* ---------- notifications, built from the same state ---------- */
function notificationItems() {
  const items = [];
  if (state.mode === "outage") items.push({ id: "outage", alert: true, icon: "battery-warning", title: "Grid outage", text: `Batteries are running ${allDevices().filter(isProtected).length} protected devices for about ${hoursLabel(availableKWh() / protectedKW())}.`, go: "overview" });
  if (!suggestions[0].applied) items.push({ id: "standby", icon: "power", title: "Standby devices idle for 3 hours", text: `Your TV and game console are drawing 21 W. Pausing them saves about ${suggestions[0].savings.replace(" / year", "")} a year.`, go: "insights" });
  else items.push({ id: "standby-done", icon: "check", title: "Standby devices paused", text: "Use Restore now in Insights or Overview to remove this suggestion pause. An outage plan can keep flexible standby paused.", go: "ports" });
  items.push(suggestions[1].applied
    ? { id: "dish-done", icon: "clock-3", title: "Dishwasher moved to 10:30 PM", text: "It runs after the evening peak tonight.", go: "ports" }
    : { id: "dish", icon: "clock-3", title: "Dishwasher timing", text: "Running it after 9 PM avoids the evening peak.", go: "insights" });
  items.push({ id: "report", icon: "chart-no-axes-combined", title: "Monthly progress", text: `You saved ${savedKWh} kWh over the last 4 weeks.`, go: "history" });
  return items;
}
function renderNotifications() {
  const items = notificationItems();
  $("#notificationList").innerHTML = items.map(item => `<li class="${item.alert ? "alert" : ""}"><button type="button" data-go="${item.go}" data-id="${item.id}"><i data-lucide="${item.icon}"></i><span><strong>${item.title}</strong><small>${escapeHtml(item.text)}</small></span></button></li>`).join("");
  $("#notificationDot").hidden = items.every(item => readNotifications.has(item.id));
}
function toggleNotifications(open) {
  const panelEl = $("#notificationPanel");
  const show = open ?? panelEl.hidden;
  panelEl.hidden = !show;
  $("#notificationButton").setAttribute("aria-expanded", String(show));
}
$("#notificationButton").addEventListener("click", event => { event.stopPropagation(); toggleNotifications(); });
$("#markAllRead").addEventListener("click", () => {
  notificationItems().forEach(item => readNotifications.add(item.id));
  renderNotifications();
  showToast("All notifications marked as read");
});
$("#notificationList").addEventListener("click", event => {
  const button = event.target.closest("[data-go]");
  if (!button) return;
  readNotifications.add(button.dataset.id);
  toggleNotifications(false);
  navigate(button.dataset.go);
  renderNotifications();
});
document.addEventListener("click", event => {
  if (!$("#notificationPanel").hidden && !event.target.closest("#notificationPanel, #notificationButton")) toggleNotifications(false);
});
document.addEventListener("keydown", event => { if (event.key === "Escape") toggleNotifications(false); });
renderNotifications();
if (window.lucide) lucide.createIcons();

/* ---------- presenter demo guide (press G) ---------- */
function resetDemoState() {
  ports.splice(0, ports.length, ...JSON.parse(JSON.stringify(INITIAL_PORTS)));
  suggestions.forEach(item => { item.applied = false; });
  dishwasherPreviousDetail = null;
  chartTransitionLabel = "";
  readNotifications.clear();
  $("#chatLog").innerHTML = INITIAL_CHAT;
  liveActivity.length = 0;
  activityFilter = "all";
  document.querySelectorAll("#activityFilters button").forEach(b => b.classList.toggle("active", b.dataset.filter === "all"));
  if (typeof discoveryTimers !== "undefined") { discoveryTimers.forEach(window.clearTimeout); discoveryTimers = []; }
  $("#discoveryResults").hidden = true;
  $("#discoveryProgress").hidden = true;
  $("#startDiscovery").disabled = false;
  $("#startDiscovery").classList.remove("scanning");
  $("#startDiscovery").querySelector("span").textContent = "Scan home";
  closeAssistant();
  navigate("overview");
  setMode("normal", true);
  liveActivity.length = 0;
  renderActivity();
}
function renderGuide() {
  const next = GUIDE.findIndex((_, i) => !guideDone.has(i));
  $("#guideSteps").innerHTML = GUIDE.map((step, i) => `<li class="${guideDone.has(i) ? "done" : ""} ${i === next ? "next" : ""}"><div><strong>${step.title}</strong><p>${step.say}</p></div><button type="button" data-step="${i}">Run</button></li>`).join("");
  $("#guideNext").textContent = next === -1 ? "Demo complete" : `Run step ${next + 1}`;
  $("#guideNext").disabled = next === -1;
}
function runGuideStep(i) {
  guideDone.add(i);
  GUIDE[i].run();
  renderGuide();
}
function toggleGuide(show) {
  const guide = $("#demoGuide");
  guide.hidden = !(show ?? guide.hidden);
  try { sessionStorage.setItem("wattwise.guide", guide.hidden ? "0" : "1"); } catch (error) { /* not remembered */ }
}
$("#guideSteps").addEventListener("click", event => {
  const button = event.target.closest("[data-step]");
  if (button) runGuideStep(Number(button.dataset.step));
});
$("#guideNext").addEventListener("click", () => {
  const next = GUIDE.findIndex((_, i) => !guideDone.has(i));
  if (next !== -1) runGuideStep(next);
});
$("#guideRestart").addEventListener("click", () => { guideDone.clear(); runGuideStep(0); });
$("#closeGuide").addEventListener("click", () => toggleGuide(false));
$("#openGuideFromSettings").addEventListener("click", () => { settingsDialog.close(); toggleGuide(true); });
// G shows or hides the guide. Keys 1 to 8 run a step without showing anything, for a mirrored projector.
document.addEventListener("keydown", event => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest("input, textarea, select") || document.querySelector("dialog[open]")) return;
  if (event.key.toLowerCase() === "g") { toggleGuide(); return; }
  const step = Number(event.key);
  if (step >= 1 && step <= GUIDE.length) {
    if (step === 1) guideDone.clear();
    runGuideStep(step - 1);
  }
});
try { if (sessionStorage.getItem("wattwise.guide") === "1" || location.hash === "#demo") toggleGuide(true); } catch (error) { /* ignore */ }
renderGuide();
if (window.lucide) lucide.createIcons();

/* ---------- History controls ---------- */
document.querySelectorAll("[data-period]").forEach(button => button.addEventListener("click", () => {
  historyPeriod = button.dataset.period;
  document.querySelectorAll("[data-period]").forEach(b => b.classList.toggle("active", b === button));
  renderHistory();
  if (window.lucide) lucide.createIcons();
}));
$("#activityFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  activityFilter = button.dataset.filter;
  document.querySelectorAll("#activityFilters button").forEach(b => b.classList.toggle("active", b === button));
  renderActivity();
});

// Render after all review/chart bindings are initialized.
render();

// The information page links directly to these household estimates.
if (location.hash === "#insights") navigate("insights");
