/* live.js — bridge between the Wattwise UI and the real power-line bus.
 *
 * The bus is three or four XIAO boards sharing two wires that carry both power
 * and data. One is the power node; the rest are load adapters that announce
 * themselves, report their draw and shed when the budget runs short. All of it
 * over the power conductors, no data line.
 *
 * This file is additive. app.js is untouched apart from three hooks, and if the
 * hardware is absent or unreachable nothing here fires — the demo runs exactly
 * as it did before. That is deliberate: the bench should never be able to break
 * the pitch.
 *
 * Enable with ?live=192.168.4.1 (or whatever the power node's address is).
 * The setting is remembered, so ?live=off turns it back into pure simulation.
 */
(function () {
  "use strict";

  var DEFAULT_HOST = "192.168.4.1";   // the power node's access point
  var POLL_MS = 1500;
  var STORE = "wattwise.live.host";

  /* Once the bus answers, the device list is replaced outright: the simulated
   * ports disappear and only real nodes remain. Half-real is worse than either
   * — a judge cannot tell which tiles mean anything. NAMES is cosmetic only,
   * giving each node id a label that fits the story; a node with no entry
   * still appears, named after its address. */
  var NAMES = {
    1: { name: "Living room TV", icon: "tv",                room: "Living room" },
    2: { name: "Medical cooler", icon: "briefcase-medical", room: "Bedroom"     },
    3: { name: "Bedside lamp",   icon: "lamp-desk",         room: "Bedroom"     }
  };
  var SIM_PORTS = null;          // the simulated list, kept so we can restore it

  /* The UI's five levels, expressed as a bus budget in deciwatts. Stepping the
   * simulation down to "critical only" therefore cuts real hardware: the LED on
   * the bench goes out at the same moment the tile on screen does. */
  var LEVEL_BUDGET_dW = [200, 150, 120, 80, 20];

  var host = resolveHost();
  var connected = false;
  var lastSeen = 0;
  var known = {};          // node id -> last state, for edge detection
  var lastLevelPushed = null;
  var pill;
  var scanPending = false;
  var budgetDragging = false;

  function resolveHost() {
    var q = new URLSearchParams(location.search).get("live");
    if (q === "off") { try { localStorage.removeItem(STORE); } catch (e) {} return null; }
    if (q) { try { localStorage.setItem(STORE, q === "" ? DEFAULT_HOST : q); } catch (e) {} return q === "" ? DEFAULT_HOST : q; }
    try { var saved = localStorage.getItem(STORE); if (saved) return saved; } catch (e) {}
    // Served by the power node itself: talk to whoever served this page. No
    // query string, no configuration — open the board's address and it works.
    if (location.protocol.indexOf("http") === 0 &&
        location.hostname && !/^(localhost|127\.|0\.0\.0\.0$)/.test(location.hostname)) {
      return location.host;
    }
    return null;
  }

  /* ---------- status pill ---------- */

  // A floating control for the real bus. Injected rather than built into the
  // page, so it exists only when hardware is actually connected and the
  // simulation is untouched without it.
  function makePill() {
    pill = document.createElement("div");
    pill.id = "liveBusPill";
    pill.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "z-index:9999",
      "width:260px", "padding:14px 16px", "border-radius:14px",
      "font:13px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif",
      "background:rgba(18,21,25,.95)", "color:#e8eaed",
      "box-shadow:0 8px 28px rgba(0,0,0,.35)",
      "backdrop-filter:blur(8px)"
    ].join(";");
    pill.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span id="liveBusDot" style="width:8px;height:8px;border-radius:50%;background:#ff6b81;flex:none"></span>' +
        '<span id="liveBusText" style="font-weight:600;letter-spacing:.03em;' +
        'text-transform:uppercase;font-size:11px">power line: offline</span>' +
        '<button id="liveBusFold" style="margin-left:auto;background:none;border:0;' +
        'color:#9aa3af;cursor:pointer;font-size:15px;line-height:1;padding:0">–</button>' +
      '</div>' +
      '<div id="liveBusBody">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline">' +
          '<span style="font-size:24px;font-weight:600;font-variant-numeric:tabular-nums">' +
          '<span id="liveBudget">–</span> W</span>' +
          '<span id="liveAlloc" style="color:#9aa3af;font-size:12px"></span>' +
        '</div>' +
        '<input id="liveBudgetSlider" type="range" min="0" max="120" step="5" value="100" ' +
        'style="width:100%;accent-color:#6ea8fe;margin:10px 0 2px">' +
        '<div style="color:#9aa3af;font-size:11.5px">Available power on the bus. ' +
        'Loads shed in priority order — lowest number survives longest.</div>' +
        '<div id="liveNodes" style="margin-top:10px;display:grid;gap:5px"></div>' +
      '</div>';
    document.body.appendChild(pill);

    var slider = document.getElementById("liveBudgetSlider");
    slider.addEventListener("input", function () {
      budgetDragging = true;
      document.getElementById("liveBudget").textContent = (slider.value / 10).toFixed(1);
    });
    slider.addEventListener("change", function () {
      fetch("http://" + host + "/api/budget?dw=" + slider.value)
        .catch(function () {})
        .then(function () { budgetDragging = false; tick(); });
    });
    document.getElementById("liveBusFold").addEventListener("click", function () {
      var b = document.getElementById("liveBusBody");
      var hidden = b.style.display === "none";
      b.style.display = hidden ? "" : "none";
      this.textContent = hidden ? "–" : "+";
    });
  }

  function setPill(text, ok) {
    if (!pill) return;
    document.getElementById("liveBusDot").style.background = ok ? "#3fcf8e" : "#ff6b81";
    document.getElementById("liveBusText").textContent = text;
  }

  // Mirror the bus in the panel, so the shed order is visible even when the
  // Ports page is not the one on screen.
  function setPanel(data) {
    if (!pill) return;
    if (!budgetDragging) {
      document.getElementById("liveBudget").textContent = (data.budget_dW / 10).toFixed(1);
      document.getElementById("liveBudgetSlider").value = data.budget_dW;
    }
    document.getElementById("liveAlloc").textContent =
      (data.alloc_dW / 10).toFixed(1) + " W allocated";

    var rows = [];
    if (data.local) rows.push({ name: "Controller", prio: data.local.prio, on: data.local.on, present: true });
    (data.nodes || []).forEach(function (n) {
      rows.push({ name: (NAMES[n.id] && NAMES[n.id].name) || ("Load " + n.id),
                  prio: n.prio, on: n.on, present: n.present });
    });
    rows.sort(function (a, b) { return a.prio - b.prio; });

    document.getElementById("liveNodes").innerHTML = rows.map(function (r) {
      var colour = !r.present ? "#4b5563" : r.on ? "#3fcf8e" : "#ff6b81";
      var label  = !r.present ? "gone" : r.on ? "on" : "shed";
      return '<div style="display:flex;align-items:center;gap:7px;font-size:12px">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + colour + ';flex:none"></span>' +
        '<span style="opacity:.9">' + r.name + '</span>' +
        '<span style="color:#6b7280;font-size:11px">p' + r.prio + '</span>' +
        '<span style="margin-left:auto;color:' + colour + ';font-size:11px">' + label + '</span></div>';
    }).join("");
  }

  /* ---------- model plumbing ---------- */

  var LEVEL_OF_PRIO = function (prio) {
    if (prio <= 0) return "Critical";
    if (prio <= 2) return "Important";
    return "Flexible";
  };

  // Replace the whole device list with what is actually on the bus.
  function applyNodes(nodes) {
    if (!SIM_PORTS) SIM_PORTS = ports.slice();
    ports.length = 0;

    nodes.forEach(function (node) {
      var meta = NAMES[node.id] || {};
      ports.push({
        port: "Node " + node.id,
        room: meta.room || "Bus",
        status: node.present ? "Online" : "Gone",
        live: true,
        devices: [{
          name: meta.name || ("Load " + node.id),
          icon: meta.icon || "plug-zap",
          liveId: node.id,
          level: LEVEL_OF_PRIO(node.prio),
          watts: Math.round(node.draw_dW / 10),        // deciwatts -> watts
          detail: "",
          liveShed: !(node.present && node.on),
          liveDetail: !node.present
            ? "Left the bus · no longer answering"
            : node.on
              ? "Running · commanded over the power line · " + node.rtt + " ms round trip"
              : "Shed by the power budget · command sent over the power line"
        }]
      });
    });

    if (!ports.length) ports.push({ port: "Power line bus", room: "Bus", status: "Online",
                                    live: true, devices: [] });
  }

  function restoreSim() {
    if (!SIM_PORTS) return;
    ports.length = 0;
    SIM_PORTS.forEach(function (p) { ports.push(p); });
    SIM_PORTS = null;
  }

  /* ---------- edge detection -> activity log ---------- */

  function announce(node) {
    var was = known[node.id];
    var name = (NAMES[node.id] && NAMES[node.id].name) || ("Load " + node.id);

    if (!was && node.present)
      logEvent("network", "plug-zap", name + " joined over the power line",
        "A new adapter announced itself on the power conductors and was given " + (node.draw_dW / 10).toFixed(1) + " W of the budget. No data wire, no pairing.", "line");
    else if (was && was.present && !node.present)
      logEvent("network", "unplug", name + " left the bus",
        "Three polls went unanswered, so its share of the budget was released to the other loads.", "line");
    else if (was && was.present && node.present && was.on !== node.on)
      logEvent(node.on ? "savings" : "protection", node.on ? "power" : "pause",
        name + (node.on ? " restored" : " shed to stay inside the budget"),
        node.on
          ? "Budget recovered, so the command to switch back on went out over the power line."
          : "Priority " + node.prio + ". The command travelled over the power conductors; nothing else carries it.", "line");

    known[node.id] = { present: node.present, on: node.on };
  }

  /* ---------- level -> real budget ---------- */

  function pushBudget() {
    if (!connected) return;
    var level = Math.max(0, Math.min(4, state.level | 0));
    if (level === lastLevelPushed) return;
    lastLevelPushed = level;
    fetch("http://" + host + "/api/budget?dw=" + LEVEL_BUDGET_dW[level]).catch(function () {});
  }

  /* ---------- the Ports page controls the real bus ---------- */

  var PRIO_OF_LEVEL = { Critical: 0, Important: 2, Flexible: 4 };

  // Changing a priority on the Ports page sets it on the node itself. It rides
  // out with that node's next poll and is saved in its flash, so it survives a
  // reboot — the dropdown is configuring hardware, not a label.
  function wirePriority() {
    var list = document.getElementById("portList");
    if (!list) return;
    list.addEventListener("change", function (ev) {
      if (!connected || !ev.target.matches("select")) return;
      var pi = Number(ev.target.dataset.port);
      var port = ports[pi];
      if (!port || !port.live) return;
      var dev = port.devices[Number(ev.target.dataset.device)];
      if (!dev || dev.liveId === undefined) return;
      var prio = PRIO_OF_LEVEL[ev.target.value];
      if (prio === undefined) return;
      fetch("http://" + host + "/api/prio?id=" + dev.liveId + "&prio=" + prio).catch(function () {});
      logEvent("protection", prio === 0 ? "shield-check" : "shield-off",
        dev.name + " set to " + ev.target.value,
        "Priority written to the adapter over the power line. It is stored on the "
        + "node, so it survives a power cycle.", "line");
    }, true);   // capture: run before the app's own handler re-renders
  }

  // The scan button asks the bus who is out there, rather than replaying a
  // scripted animation. The node widens its discovery window; anything
  // unenrolled answers and appears in the table.
  function wireScan() {
    var btn = document.getElementById("startDiscovery");
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!connected) return;
      fetch("http://" + host + "/api/discover").catch(function () {});
      logEvent("network", "scan-search", "Scanning the power line",
        "Asked every adapter on the power conductors to identify itself. "
        + "Nothing transmits unless invited, so the bus stays collision free.", "line");
      scanPending = true;
    }, true);
  }

  // Replace the scripted scan results with what actually answered. There is no
  // confidence score here on purpose: these devices are not being inferred from
  // a power signature, they stated their own address and priority over the bus.
  function renderScan(nodes) {
    var wrap = document.querySelector(".discovered-loads");
    if (!wrap) return;
    var live = nodes.filter(function (n) { return n.present; });

    wrap.innerHTML = live.map(function (n) {
      var meta = NAMES[n.id] || {};
      var critical = n.prio <= 0;
      return '<article class="discovered-load revealed">' +
        '<div class="load-icon smart"><i data-lucide="' + (meta.icon || 'plug-zap') + '"></i></div>' +
        '<div class="load-copy"><h4>' + (meta.name || ('Load ' + n.id)) + '</h4>' +
        '<p>Node ' + n.id + ' · answered over the power line in ' + n.rtt + ' ms</p>' +
        '<span class="confidence"><i style="width:100%"></i></span></div>' +
        '<div class="load-state"><span class="control-badge smart">' +
        '<i data-lucide="zap"></i>Power line control</span>' +
        '<small>identified, not inferred</small></div>' +
        '<div class="outage-action ' + (critical ? 'protected' : '') + '">' +
        '<i data-lucide="' + (critical ? 'shield-check' : 'pause') + '"></i>' +
        '<span><small>When power is short</small><strong>' +
        (critical ? 'Protect' : 'Can shed') + '</strong></span></div></article>';
    }).join('');

    var sum = document.querySelector(".discovery-summary");
    if (sum) {
      var strong = sum.querySelector("strong"), small = sum.querySelector("small"),
          pill = sum.querySelector(".simulation-pill");
      if (strong) strong.textContent = live.length + " adapter" + (live.length === 1 ? "" : "s") + " answered";
      if (small)  small.textContent  = "all controllable over the power conductors";
      if (pill)   pill.textContent   = "Live scan";
    }
    if (window.lucide) lucide.createIcons();
  }

  /* ---------- poll ---------- */

  function tick() {
    if (!host) return;
    fetch("http://" + host + "/api/state", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!connected) {
          connected = true;
          logEvent("network", "radio", "Power line bus connected",
            "The dashboard is now reading the real hardware. Device states below come from frames carried on the power conductors.", "line");
        }
        lastSeen = Date.now();

        applyNodes(data.nodes || []);
        (data.nodes || []).forEach(announce);
        renderScan(data.nodes || []);
        setPanel(data);

        var sub = document.getElementById("sub");
        if (sub) {
          var n = (data.nodes || []).filter(function (x) { return x.present; }).length;
          sub.innerHTML = '<span class="dot" style="display:inline-block;width:7px;height:7px;' +
            'border-radius:50%;background:#3fcf8e;margin-right:7px"></span>' +
            n + ' device' + (n === 1 ? '' : 's') + ' on the power line — real hardware. ' +
            'Battery, history and pricing below are simulated.';
        }

        var live = (data.nodes || []).filter(function (n) { return n.present; }).length;
        setPill("power line · " + live + " node" + (live === 1 ? "" : "s") + " · " + data.bps + " bps", true);

        pushBudget();
        if (typeof render === "function") render();
      })
      .catch(function () {
        if (connected && Date.now() - lastSeen > 6000) {
          connected = false;
          lastLevelPushed = null;
          restoreSim();                     // bus gone: fall back rather than lie
          setPill("power line: offline", false);
          if (typeof render === "function") render();
        }
      });
  }

  function start() {
    makePill();
    if (!host) { setPill("simulation only", false); pill.style.opacity = "0.5"; return; }
    setPill("power line: connecting…", false);
    wirePriority();
    wireScan();
    tick();
    setInterval(tick, POLL_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
