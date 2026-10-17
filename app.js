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
  standbyHoursPerDay: 20
};

// Electricity plans the household can pick in Settings. Prices are rounded 2026 figures for the demo.
const PLANS = {
  sce: { label: "SCE TOU-D-4-9PM", price: 0.385, peakDiff: 0.24, note: "Southern California Edison time-of-use. Standby load is priced at about 38.5¢/kWh averaged over the day; the 4 to 9 PM peak costs about 24¢/kWh more than off-peak." },
  ladwp: { label: "LADWP R-1A", price: 0.30, peakDiff: 0, note: "Los Angeles Department of Water and Power tiered plan, about 30¢/kWh. The price does not change by time of day, so shifting loads saves no money, only peak demand." }
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
  { id: "standby", title: "Pause standby entertainment", body: "Your TV and game console sit on standby about 20 hours a day. Pause both now and restore power when you return.", impact: "Best match", icon: "power", watts: "21 W", savings: "", applied: false },
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
  { type: "protection", when: "Oct 9, 3:05 PM", icon: "shield-check", title: "Medical cooler marked Critical", detail: "Set by Iris. Wattwise will never switch it off.", channel: "app" },
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
  if (outageCut(device)) return 0;
  if (isStandbyPaused(device)) return 0;
  return device.watts;
}
function deviceDetail(device) {
  if (outageCut(device)) return state.level >= 4 ? "Paused · critical-only backup" : "Paused · standby waste cut on battery";
  if (isStandbyPaused(device)) return "Paused by Wattwise · restores when you return";
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
function renderPorts() {
  portList.innerHTML = ports.map((port, portIndex) => `
    <article class="port-card ${port.devices.length ? "" : "empty-port"}">
      <header class="port-card-header">
        <div class="port-symbol"><i data-lucide="blocks"></i></div>
        <div><span class="port-kicker">${port.status}</span><h3>${port.port}</h3><p>${port.room} · ${port.devices.length} ${port.devices.length === 1 ? "device" : "devices"}</p></div>
        <strong>${port.devices.reduce((total, device) => total + deviceDraw(device), 0)} W</strong>
      </header>
      <div class="nested-devices">
        ${port.devices.length ? port.devices.map((device, deviceIndex) => `
          <div class="nested-device ${deviceDraw(device) === 0 && device.watts > 0 ? "paused-device" : ""}">
            <div class="device-icon"><i data-lucide="${device.icon}"></i></div>
            <div class="nested-device-copy"><h4>${escapeHtml(device.name)}</h4><p>${deviceDetail(device)}</p></div>
            <span class="nested-watts">${deviceDraw(device)} W</span>
            <label><span class="sr-only">Criticality for ${escapeHtml(device.name)} on ${port.port}</span><select class="criticality-select" data-port="${portIndex}" data-device="${deviceIndex}">
              ${["Critical", "Important", "Flexible"].map(level => `<option ${level === device.level ? "selected" : ""}>${level}</option>`).join("")}
            </select></label>
            <button class="edit-device" data-edit-port="${portIndex}" data-edit-device="${deviceIndex}" aria-label="Edit ${escapeHtml(device.name)}"><i data-lucide="pencil"></i></button>
          </div>`).join("") : `<p class="empty-message">No devices assigned yet.</p>`}
      </div>
      <button class="add-device-to-port" data-add-port="${portIndex}"><i data-lucide="plus"></i>Add device to ${port.port}</button>
    </article>`).join("");
}

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

// Savings follow the chosen plan: standby is 21 W for about 20 h a day; the dishwasher runs about 15 times a month.
function priceSuggestions() {
  const standbyYear = 21 * MODEL.standbyHoursPerDay * 365 / 1000 * plan().price;
  suggestions[0].savings = `$${Math.round(standbyYear)} / year`;
  $("#quickInsightSaving").textContent = `$${Math.round(standbyYear)}`;
  const dish = suggestions[1];
  if (plan().peakDiff > 0) {
    dish.body = `Running it after the 4 to 9 PM peak costs about ${Math.round(plan().peakDiff * 100)}¢ less per kWh. Your dishes will still be ready by morning.`;
    dish.savings = `$${(1.2 * 15 * plan().peakDiff).toFixed(2)} / month`;
  } else {
    dish.body = "Your plan charges the same at every hour, so this saves no money, but it moves 1.2 kWh out of the evening peak when the grid is most stressed.";
    dish.savings = "Eases the evening peak";
  }
}

function renderSuggestions() {
  priceSuggestions();
  suggestionList.innerHTML = suggestions.map((item, index) => `
    <article class="suggestion-card">
      <div class="suggestion-top"><div class="device-icon"><i data-lucide="${item.icon}"></i></div><span class="impact-pill">${item.applied ? "Applied" : item.impact}</span></div>
      <h3>${item.title}</h3><p>${item.body}</p>
      <div class="suggestion-stats"><span>Impact<strong>${item.watts}</strong></span><span>Estimated saving<strong>${item.savings}</strong></span></div>
      <button class="button suggestion-apply" data-suggestion="${index}" ${item.applied ? "disabled" : ""}>${item.applied ? "Applied" : "Review & apply"}</button>
    </article>`).join("");
  const open = suggestions.filter(item => !item.applied).length;
  $("#insightCountBadge").textContent = open;
  $("#insightCountBadge").hidden = open === 0;
  $("#insightCountLabel").textContent = open ? `${open} READY FOR REVIEW` : "ALL SUGGESTIONS APPLIED";

  const quick = $("#applySuggestion");
  quick.disabled = suggestions[0].applied;
  const pausedW = allDevices().filter(isStandbyPaused).reduce((sum, d) => sum + d.watts, 0);
  quick.textContent = suggestions[0].applied ? `Paused · ${pausedW} W saved` : "Pause standby devices";
  $("#quickInsightLabel").textContent = suggestions[0].applied ? "SAVING ENERGY NOW" : "NEW SUGGESTION";
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
    ? state.level >= 4 ? `Only protected devices are powered · ${Math.round(protectedKW() * 1000)} W` : "On battery · standby cut, flexible loads waiting"
    : pct > 0 ? `${diff.toFixed(1)} kW lower than your usual ${weekday}` : `About the same as your usual ${weekday}`;

  $("#runtimeLabel").textContent = outage ? "Runtime at this level" : "Protected runtime";
  $("#runtimeValue").textContent = hoursLabel(runtime);
  const protectedLoads = allDevices().filter(isProtected).length;
  const deferred = allDevices().filter(d => d.level === "Flexible" && d.watts > 0 && deviceDraw(d) === 0).length + (state.level >= 2 ? 1 : 0);
  $("#protectedCount").textContent = `${protectedLoads} ${protectedLoads === 1 ? "load" : "loads"}`;
  $("#deferredCount").textContent = `${deferred} flexible`;
  $("#batteryTitle").textContent = outage ? `Battery plan: Level ${state.level}` : "Power plan agreed";
  $("#batteryText").textContent = outage
    ? `Devices are sharing ${Math.round(kw * 1000)} W of battery power for about ${hoursLabel(runtime)}. Expected outage: ${state.outageHours} h.`
    : `Devices are sharing what they need, what can wait, and which loads must remain protected. If the grid drops, protected devices last about ${hoursLabel(protectedRuntime)}.`;
  $(".battery-status").classList.toggle("discharging", outage);

  $("#gridDot").classList.toggle("outage", outage);
  $("#gridTitle").textContent = outage ? "Grid outage" : "Grid connected";
  $("#gridSubtitle").textContent = outage ? `On battery · ${hoursLabel(runtime)} left` : "Home is protected";
  $("#livePill").classList.toggle("on-battery", outage);
  $("#livePillText").textContent = outage ? "On battery" : "Live";

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

render();

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
  state.level = mode === "normal" ? 0 : mode === "saver" ? 2 : 3;
  if (mode === "outage") logEvent("outage", "zap-off", "Grid outage started", `Expected to last ${state.outageHours} h. Level 3 on battery: about ${hoursLabel(runtimeAt(3))} at this level.`);
  else if (wasOutage) logEvent("outage", "plug-zap", "Grid power restored", "Batteries back on standby. Paused loads returned on their own.");
  else logEvent("savings", mode === "saver" ? "leaf" : "layout-dashboard", mode === "saver" ? "Smart saver turned on" : "Normal mode", mode === "saver" ? "Standby loads pause automatically; loads that can wait run at cheaper hours." : "Everything runs as you use it. Wattwise keeps watching.", "app");
  if (mode === "outage") {
    stepDownTimer = setTimeout(() => {
      stepDownTimer = null;
      if (state.mode !== "outage") return;
      if (runtimeAt(3) < state.outageHours) {
        state.level = 4;
        logEvent("outage", "shield-check", "Stepped down to Level 4, critical only", `Level 3 would last ${hoursLabel(runtimeAt(3))}, short of the expected ${state.outageHours} h. Protected devices now last about ${hoursLabel(runtimeAt(4))}.`);
        render();
        showToast(`Level 3 would last ${hoursLabel(runtimeAt(3))}. Stepping down to critical only: ${hoursLabel(runtimeAt(4))}`);
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

/* ---------- suggestions (overview card and insights page share one state) ---------- */
function applySuggestion(index) {
  const item = suggestions[index];
  if (item.applied) return;
  item.applied = true;
  if (item.id === "dishwasher") ports[0].devices[1].detail = "Moved to 10:30 PM tonight";
  logEvent("savings", item.id === "standby" ? "power" : "clock-3", item.id === "standby" ? "TV and game console paused" : "Dishwasher moved to 10:30 PM", item.id === "standby" ? `Approved in the app. Saves 21 W, about ${suggestions[0].savings.replace(" / year", "")} a year.` : "It now runs after the 4 to 9 PM peak.");
  render();
  showToast(item.id === "standby" ? "TV and game console paused safely" : `${item.title} applied`);
}

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
  logEvent("protection", level === "Critical" ? "shield-check" : "shield-off", `${device.name} set to ${level}`, before === "Critical" ? "Protection removed after confirmation." : level === "Critical" ? "Wattwise will never switch it off." : `Changed from ${before}.`, "app");
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
    $("#confirmTitle").textContent = `Remove protection from ${device.name}?`;
    $("#confirmText").textContent = `${device.name} will no longer be guaranteed power during an outage${level === "Flexible" ? " and may be paused to save energy" : ""}.`;
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
      $("#confirmTitle").textContent = `Remove protection from ${device.name}?`;
      $("#confirmText").textContent = `${device.name} will no longer be guaranteed power during an outage${level === "Flexible" ? " and may be paused to save energy" : ""}.`;
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
  $("#gridDialogAction").textContent = outage ? "Restore grid power" : "Simulate an outage";
  $("#outagePicker").hidden = outage;
  $("#outageHours").value = String(state.outageHours);
  gridDialog.showModal();
}
$("#gridCard").addEventListener("click", openGridDialog);
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
  else items.push({ id: "standby-done", icon: "check", title: "Standby devices paused", text: "Your TV and game console will power back on when you use them.", go: "ports" });
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
