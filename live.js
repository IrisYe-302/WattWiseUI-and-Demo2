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

  function resolveHost() {
    var q = new URLSearchParams(location.search).get("live");
    if (q === "off") { try { localStorage.removeItem(STORE); } catch (e) {} return null; }
    if (q) { try { localStorage.setItem(STORE, q === "" ? DEFAULT_HOST : q); } catch (e) {} return q === "" ? DEFAULT_HOST : q; }
    try { return localStorage.getItem(STORE); } catch (e) { return null; }
  }

  /* ---------- status pill ---------- */

  function makePill() {
    pill = document.createElement("div");
    pill.id = "liveBusPill";
    pill.style.cssText = [
      "position:fixed", "right:16px", "bottom:16px", "z-index:9999",
      "display:flex", "align-items:center", "gap:8px",
      "padding:8px 14px", "border-radius:999px",
      "font:600 12px/1 ui-sans-serif,system-ui,sans-serif",
      "letter-spacing:.04em", "text-transform:uppercase",
      "background:rgba(20,23,26,.92)", "color:#e8eaed",
      "box-shadow:0 4px 16px rgba(0,0,0,.25)", "cursor:default",
      "transition:opacity .3s"
    ].join(";");
    pill.innerHTML = '<span id="liveBusDot" style="width:8px;height:8px;border-radius:50%;background:#ff6b81"></span><span id="liveBusText">power line: offline</span>';
    document.body.appendChild(pill);
  }

  function setPill(text, ok) {
    if (!pill) return;
    document.getElementById("liveBusDot").style.background = ok ? "#3fcf8e" : "#ff6b81";
    document.getElementById("liveBusText").textContent = text;
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
    tick();
    setInterval(tick, POLL_MS);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
