// plc_node.ino — one firmware for every node on the power-line bus.
//
// Role and address live in flash, not in a #define, so the same binary runs on
// all four boards: `role load`, `id 2`, `save`, done.
//
// Bus access is master-polled. The power node starts every transaction and a
// load answers only its own address, so enrolled traffic can never collide.
// The one exception is discovery: a load that hasn't been polled recently
// announces itself with a random backoff, which is how a node that gets
// plugged into a live bus joins within a few seconds instead of waiting for
// the master to scan every possible address.

#include "plc_common.h"
#include "config.h"
#include "statusled.h"
#include "dashboard.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <LittleFS.h>
#include "esp_task_wdt.h"

void handleSerialPublic();   // defined below; the power node's gap calls it

// ----------------------------------------------------------------- protocol -
#define MSG_POLL     0x01   // power -> load:  [budget hi,lo][grant][prio or 0xFF]
#define MSG_STATUS   0x02   // load  -> power: [on][draw hi,lo][prio][seq]
#define MSG_PING     0x03
#define MSG_PONG     0x04
#define MSG_HELLO    0x05   // load -> power, in a discovery window: [prio][draw hi,lo]
#define MSG_DISCOVER 0x06   // power -> all: anyone not enrolled, speak now

#define REPLY_GUARD_MS   40     // let the far end get back into receive
#define LINK_TIMEOUT_MS  7000
#define MISS_LIMIT       2      // consecutive misses before a node is dropped
#define DISCOVER_WINDOW_MS 700  // long enough for one HELLO plus its backoff
#define GAP_MS           900    // listen / serve the dashboard between cycles

static uint8_t txbuf[PLC_MAX_PAYLOAD];

static bool sendMsg(uint8_t dst, uint8_t type, const uint8_t *body, uint8_t n) {
  txbuf[0] = cfg.id;
  txbuf[1] = dst;
  txbuf[2] = type;
  if (n) memcpy(txbuf + 3, body, n);
  ledTx(true);
  bool ok = plcSend(txbuf, (uint8_t)(3 + n));
  ledTx(false);
  return ok;
}

// Returns payload length, or 0. Filters to frames addressed to us.
static uint8_t readMsg(uint8_t *out) {
  if (!plcAvailable()) return 0;
  uint8_t n = plcRead(out, PLC_MAX_PAYLOAD);
  if (n < 3) return 0;
  if (out[1] != cfg.id && out[1] != ADDR_BCAST) return 0;
  ledRxFlash();
  return n;
}

static void handleUnsolicited(const uint8_t *f, uint8_t n);

static bool waitMsg(uint8_t from, uint8_t type, uint8_t *out, uint8_t *outLen, uint32_t ms) {
  uint32_t end = millis() + ms;
  while ((int32_t)(millis() - end) < 0) {
    plcPoll();
    uint8_t n = readMsg(out);
    if (!n) continue;
    if (out[2] != type || (from != ADDR_BCAST && out[0] != from)) {
      // Not what we were waiting for, but a node announcing itself mid
      // transaction still counts. Without this the master only listens during
      // its gap between cycles — about 20% of the time — and a board plugged
      // in live takes ~15 s to be noticed instead of a few seconds.
      handleUnsolicited(out, n);
      continue;
    }
    *outLen = n;
    return true;
  }
  return false;
}

// ============================================================== POWER NODE ==
struct LoadRec {
  bool     present, on;
  uint8_t  misses, prio, seq, grace;
  uint16_t draw_dW, rtt;
  uint32_t lastHeard, ok, miss;
};
static LoadRec loads[MAX_LOADS + 1];
static uint8_t prioSet[MAX_LOADS + 1];   // 0xFF = leave the node's own setting
static bool    discoverNow = false;      // the UI asked for a scan
static uint16_t allocated_dW = 0;

// The controller's own directly-wired load. It has no transceiver — it is a
// GPIO and a MOSFET on this board — so it is not a demonstration of power-line
// communication and should not be pitched as one. What it is good for is being
// the critical load: priority 0, counted in the budget, so when the budget
// falls the remote nodes go dark one by one while this stays lit. The
// reservation is real, not theatre: it genuinely reduces what the bus nodes
// have left to share.
static bool localEnabled = true;
static bool localGranted = false;
static WebServer server(80);
static bool wifiUp = false;
static String netInfo = "wifi off";

// Deterministic shedding: most critical first, then by address, until the
// budget runs out. Every node applies the same rule, so the master's grant and
// a peer's own view agree.
static void recomputeGrants(bool grant[]) {
  uint16_t used = 0;
  for (int i = 0; i <= MAX_LOADS; i++) grant[i] = false;
  localGranted = false;
  for (int p = 0; p <= 255; p++) {
    // The local load competes on the same priority ladder as everyone else.
    if (localEnabled && cfg.lprio == p && used + cfg.ldraw_dW <= cfg.budget_dW) {
      localGranted = true;
      used += cfg.ldraw_dW;
    }
    for (int a = 1; a <= MAX_LOADS; a++) {
      if (!loads[a].present || loads[a].prio != p) continue;
      uint16_t d = loads[a].draw_dW ? loads[a].draw_dW : 10;
      if (used + d <= cfg.budget_dW) { grant[a] = true; used += d; }
    }
  }
  allocated_dW = used;
  if (cfg.extLoad) digitalWrite(PIN_LOAD, localGranted);
}

static void enroll(uint8_t a, uint8_t prio, uint16_t draw) {
  if (a < 1 || a > MAX_LOADS) return;
  if (!loads[a].present) {
    loads[a] = LoadRec{};
    loads[a].present = true;
    loads[a].prio = prio;
    loads[a].draw_dW = draw;
    loads[a].lastHeard = millis();
    loads[a].grace = 3;          // its HELLO may still be in flight
    Serial.printf("  + load %u joined the bus (prio %u, %.1f W)\n", a, prio, draw / 10.0);
  }
}

static void pollLoad(uint8_t a, bool grant) {
  // A priority set from the dashboard rides along with the next poll; there is
  // no separate round trip for it.
  uint8_t body[4] = {(uint8_t)(cfg.budget_dW >> 8), (uint8_t)cfg.budget_dW,
                     (uint8_t)grant, prioSet[a]};
  uint32_t t0 = millis();
  if (!sendMsg(a, MSG_POLL, body, 4)) return;

  uint8_t f[PLC_MAX_PAYLOAD], n = 0;
  LoadRec &L = loads[a];
  if (waitMsg(a, MSG_STATUS, f, &n, plcFrameMs(8) + 250) && n >= 8) {
    L.on = f[3];
    L.draw_dW = (uint16_t)(f[4] << 8) | f[5];
    L.prio = f[6];
    if (prioSet[a] != 0xFF && L.prio == prioSet[a]) prioSet[a] = 0xFF;   // applied
    L.seq = f[7];
    L.rtt = (uint16_t)(millis() - t0);
    L.lastHeard = millis();
    L.misses = 0;
    L.ok++;
    PlcStats s = plcStats();
    Serial.printf("[%7.1fs] load%u %-3s %4.1fW prio%u seq%3u rtt%4ums grant=%u | "
                  "ok=%lu miss=%lu depth=%u crc=%lu sync=%lu\n",
                  millis() / 1000.0, a, L.on ? "ON" : "OFF", L.draw_dW / 10.0, L.prio,
                  L.seq, L.rtt, grant, (unsigned long)L.ok, (unsigned long)L.miss,
                  plcLastDepth(), (unsigned long)s.crcErr, (unsigned long)s.syncErr);
  } else {
    L.miss++;
    if (L.grace) { L.grace--; L.misses = 0; Serial.printf("[%7.1fs] load%u settling\n", millis() / 1000.0, a); return; }
    if (++L.misses >= MISS_LIMIT) {
      L.present = false;
      Serial.printf("  - load %u left the bus (%u missed polls) — budget released\n", a, L.misses);
    } else {
      Serial.printf("[%7.1fs] load%u no reply (%u/%u)\n", millis() / 1000.0, a, L.misses, MISS_LIMIT);
    }
  }
}

static void powerCycle() {
  bool grant[MAX_LOADS + 1];
  recomputeGrants(grant);

  int present = 0, degraded = 0;
  for (int a = 1; a <= MAX_LOADS; a++) {
    if (!loads[a].present) continue;
    present++;
    pollLoad((uint8_t)a, grant[a]);
    if (loads[a].misses) degraded++;
  }
  ledState(present == 0 ? LED_SEARCHING : (degraded ? LED_LOST : LED_HEALTHY));
}

static void handleUnsolicited(const uint8_t *f, uint8_t n) {
  if (cfg.role != ROLE_POWER) return;
  if (n >= 6 && f[2] == MSG_HELLO)
    enroll(f[0], f[3], (uint16_t)(f[4] << 8) | f[5]);
}

// Between cycles, invite anyone unenrolled to speak, then listen. Nothing
// transmits unasked on this bus: an announcement landing in the middle of a
// poll/reply exchange corrupts both, which showed up as enrolled nodes being
// randomly marked gone while a new node was trying to join.
static void powerGap() {
  uint8_t f[PLC_MAX_PAYLOAD];
  sendMsg(ADDR_BCAST, MSG_DISCOVER, nullptr, 0);
  uint32_t end = millis() + (discoverNow ? DISCOVER_WINDOW_MS * 3 : DISCOVER_WINDOW_MS);
  discoverNow = false;
  while ((int32_t)(millis() - end) < 0) {
    plcPoll();
    uint8_t n = readMsg(f);
    if (n) handleUnsolicited(f, n);
    // No server.handleClient() here. It can block for milliseconds, which
    // punches holes in a 60 us sample cadence and destroys the correlator's
    // lock — with the AP up, nodes could be polled but never heard announcing
    // themselves, because announcements only ever arrive during this gap.
    // The web server runs on core 0 instead, alongside the wifi stack.
    handleSerialPublic();
  }
}

// --------------------------------------------------------------- dashboard --
static String stateJson() {
  PlcStats s = plcStats();
  String j = "{\"budget_dW\":" + String(cfg.budget_dW) +
             ",\"alloc_dW\":" + String(allocated_dW) +
             ",\"bps\":" + String(1000000UL / plcBitUs()) +
             ",\"depth\":" + String(plcLastDepth()) +
             ",\"crc\":" + String(s.crcErr) +
             ",\"sync\":" + String(s.syncErr) +
             ",\"uptime\":" + String(millis() / 1000) +
             ",\"local\":{\"on\":" + String(localGranted ? "true" : "false") +
             ",\"enabled\":" + String(localEnabled ? "true" : "false") +
             ",\"draw_dW\":" + String(cfg.ldraw_dW) +
             ",\"prio\":" + String(cfg.lprio) + "},\"nodes\":[";
  bool first = true;
  for (int a = 1; a <= MAX_LOADS; a++) {
    LoadRec &L = loads[a];
    if (!L.present && L.ok == 0) continue;
    if (!first) j += ",";
    first = false;
    j += "{\"id\":" + String(a) + ",\"present\":" + (L.present ? "true" : "false") +
         ",\"on\":" + (L.on && L.present ? "true" : "false") +
         ",\"draw_dW\":" + String(L.draw_dW) + ",\"prio\":" + String(L.prio) +
         ",\"rtt\":" + String(L.rtt) + ",\"ok\":" + String(L.ok) +
         ",\"miss\":" + String(L.miss) + "}";
  }
  return j + "]}";
}

static void wifiBegin() {
  if (cfg.ssid.length()) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(cfg.ssid.c_str(), cfg.pass.c_str());
    Serial.printf("wifi: joining %s", cfg.ssid.c_str());
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print("."); }
    Serial.println();
    if (WiFi.status() == WL_CONNECTED) {
      // Advertise a stable name so the dashboard URL survives a DHCP change.
      if (MDNS.begin("powerbus")) MDNS.addService("http", "tcp", 80);
      netInfo = "http://" + WiFi.localIP().toString() + "  (or http://powerbus.local)";
      wifiUp = true;
    } else {
      Serial.println("wifi: join failed, falling back to access point");
    }
  }
  if (!wifiUp) {
    // An access point by default: a hackathon venue's wifi is not something to
    // bet the demo on, and judges can join this directly.
    // Name it from the efuse MAC, which is readable before the radio starts.
    // WiFi.macAddress() here returns junk until WiFi.mode() has run, so the
    // SSID changed on every boot — not something to hand to judges.
    uint64_t id = ESP.getEfuseMac();
    char ap[32]; snprintf(ap, sizeof(ap), "powerbus-%02X%02X",
                          (uint8_t)(id >> 8), (uint8_t)id);
    WiFi.mode(WIFI_AP);
    WiFi.softAP(ap, "powerbus");
    if (MDNS.begin("powerbus")) MDNS.addService("http", "tcp", 80);
    netInfo = String(ap) + " / powerbus -> http://" + WiFi.softAPIP().toString();
    wifiUp = true;
  }
  // The Wattwise UI is served from somewhere else (a laptop, or file://), so
  // the API has to be readable cross-origin. Read-only state on a private
  // demo access point; nothing here is worth protecting.
  server.enableCORS(true);

  // The real UI lives in the 1.5 MB filesystem partition, uploaded separately.
  // If it is there we serve it; if not we fall back to the built-in page, so a
  // board that has only had firmware flashed still comes up with a dashboard.
  const bool haveUI = LittleFS.begin(false) && LittleFS.exists("/index.html");
  if (haveUI) {
    // no-cache on the documents: the built-in page was served from these same
    // URLs earlier, and a stale copy looks exactly like "the upload did not work"
    server.serveStatic("/", LittleFS, "/index.html", "no-cache");
    server.serveStatic("/index.html", LittleFS, "/index.html", "no-cache");
    server.serveStatic("/app.js", LittleFS, "/app.js", "no-cache");
    server.serveStatic("/live.js", LittleFS, "/live.js", "no-cache");
    server.serveStatic("/estimates.js", LittleFS, "/estimates.js", "no-cache");
    server.serveStatic("/styles.css", LittleFS, "/styles.css", "no-cache");
    server.serveStatic("/info.html", LittleFS, "/info.html");
    server.serveStatic("/info.css", LittleFS, "/info.css");
    server.serveStatic("/assets/", LittleFS, "/assets/", "max-age=86400");
    server.on("/builtin", []() { server.send_P(200, "text/html", DASHBOARD_HTML); });
  } else {
    server.on("/", []() { server.send_P(200, "text/html", DASHBOARD_HTML); });
  }
  server.on("/api/state", []() { server.send(200, "application/json", stateJson()); });
  server.on("/api/prio", []() {
    // Queued, not immediate: it goes out with that node's next poll.
    if (server.hasArg("id") && server.hasArg("prio")) {
      int id = server.arg("id").toInt();
      if (id >= 1 && id <= MAX_LOADS) prioSet[id] = (uint8_t)server.arg("prio").toInt();
    }
    server.send(200, "application/json", stateJson());
  });
  server.on("/api/discover", []() {
    discoverNow = true;
    server.send(200, "application/json", "{\"scanning\":true}");
  });
  server.on("/api/budget", []() {
    if (server.hasArg("dw")) cfg.budget_dW = (uint16_t)server.arg("dw").toInt();
    server.send(200, "application/json", stateJson());
  });
  server.begin();

  // Core 0 runs the wifi stack; put the web server there too and leave core 1
  // entirely to the bit-banged sampler.
#if portNUM_PROCESSORS > 1
  xTaskCreatePinnedToCore([](void *) {
    for (;;) { server.handleClient(); vTaskDelay(pdMS_TO_TICKS(5)); }
  }, "web", 8192, nullptr, 1, nullptr, 0);
  Serial.printf("dashboard: %s  (served on core 0, %s)\n", netInfo.c_str(),
                haveUI ? "full UI from flash" : "built-in page — no UI uploaded");
#else
  Serial.printf("dashboard: %s (%s)\n", netInfo.c_str(),
                haveUI ? "full UI from flash" : "built-in page");
#endif
}

// =============================================================== LOAD NODE ==
static bool     loadOn = false;
static uint8_t  seq = 0;
static uint32_t lastPoll = 0;

static void applyLoad(bool on) {
  loadOn = on;
  if (cfg.extLoad) digitalWrite(PIN_LOAD, on);
  ledLoad(on);              // built-in LED carries it when D4 isn't driven
}

static void loadService() {
  plcPoll();
  uint8_t f[PLC_MAX_PAYLOAD];
  uint8_t n = readMsg(f);

  if (n >= 6 && f[2] == MSG_POLL) {
    uint16_t budget = (uint16_t)(f[3] << 8) | f[4];
    bool granted = f[5] != 0;
    if (n >= 7 && f[6] != 0xFF && f[6] != cfg.prio) {
      cfg.prio = f[6];
      configSave();                       // survives a reboot, like any setting
      Serial.printf("priority set to %u over the power line\n", cfg.prio);
    }
    lastPoll = millis();
    applyLoad(granted);
    delay(REPLY_GUARD_MS);
    uint8_t body[5] = {(uint8_t)(loadOn ? 1 : 0),
                       (uint8_t)(cfg.draw_dW >> 8), (uint8_t)cfg.draw_dW, cfg.prio, seq++};
    sendMsg(f[0], MSG_STATUS, body, 5);
    Serial.printf("[%7.1fs] poll from %u: budget %.1fW grant %u -> load %s (seq %u)\n",
                  millis() / 1000.0, f[0], budget / 10.0, granted,
                  loadOn ? "ON" : "OFF", (uint8_t)(seq - 1));
  } else if (n >= 3 && f[2] == MSG_DISCOVER) {
    // Only answer if we are not already being polled, and scatter the replies
    // so two nodes joining together do not land on top of each other.
      const bool enrolled = lastPoll && (int32_t)(millis() - lastPoll) < LINK_TIMEOUT_MS;
    if (!enrolled) {
      delay(REPLY_GUARD_MS + random(250));
      uint8_t body[3] = {cfg.prio, (uint8_t)(cfg.draw_dW >> 8), (uint8_t)cfg.draw_dW};
      sendMsg(0, MSG_HELLO, body, 3);
      Serial.println("discovery invite — announced ourselves");
    }
  } else if (n >= 3 && f[2] == MSG_PING) {
    lastPoll = millis();
    delay(REPLY_GUARD_MS);
    sendMsg(f[0], MSG_PONG, nullptr, 0);
  }

  const bool linked = lastPoll && (int32_t)(millis() - lastPoll) < LINK_TIMEOUT_MS;


  static bool wasLinked = false;
  if (!linked && wasLinked) {
    Serial.println("LINK LOST — shedding (priority > 0)");
    if (cfg.prio > 0) applyLoad(false);
  }
  wasLinked = linked;
  ledState(linked ? LED_HEALTHY : (lastPoll ? LED_LOST : LED_SEARCHING));
}

// ================================================================== SERIAL ==
static void handleSerial() {
  static String line;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') { if (line.length() < 64) line += c; continue; }
    if (!line.length()) continue;
    String l = line; line = "";

    // --- identity, persisted ---
    if (l.startsWith("role ")) {
      cfg.role = l.substring(5).startsWith("p") ? ROLE_POWER : ROLE_LOAD;
      if (cfg.role == ROLE_POWER) cfg.id = 0;
      else if (cfg.id == 0) cfg.id = 1;
      Serial.printf("role = %s (save + reboot to apply)\n", roleName());
    } else if (l.startsWith("id ")) {
      cfg.id = (uint8_t)l.substring(3).toInt();
      Serial.printf("id = %u (save + reboot)\n", cfg.id);
    } else if (l.startsWith("prio ")) {
      cfg.prio = (uint8_t)l.substring(5).toInt();
      Serial.printf("priority = %u\n", cfg.prio);
    } else if (l.startsWith("draw ")) {
      cfg.draw_dW = (uint16_t)(l.substring(5).toFloat() * 10);
      Serial.printf("declared draw = %.1f W\n", cfg.draw_dW / 10.0);
    } else if (l == "wifi off") {
      cfg.wifiOn = false; Serial.println("wifi disabled (save + reboot)");
    } else if (l == "wifi on") {
      cfg.wifiOn = true;  Serial.println("wifi enabled (save + reboot)");
    } else if (l.startsWith("wifi ")) {
      cfg.wifiOn = true;
      int sp = l.indexOf(' ', 5);
      cfg.ssid = sp > 0 ? l.substring(5, sp) : l.substring(5);
      cfg.pass = sp > 0 ? l.substring(sp + 1) : "";
      Serial.println("wifi set (save + reboot)");
    } else if (l == "ap") {
      cfg.ssid = ""; cfg.pass = "";
      Serial.println("access point mode (save + reboot)");
    } else if (l == "save") {
      configSave(); Serial.println("saved to flash");
    } else if (l == "show") {
      configPrint(Serial);
      if (cfg.role == ROLE_POWER) Serial.printf("dashboard: %s\n", netInfo.c_str());
    } else if (l == "reboot") {
      Serial.println("rebooting"); delay(100); ESP.restart();

    // --- operation ---
    } else if (l.startsWith("b ")) {
      cfg.budget_dW = (uint16_t)(l.substring(2).toFloat() * 10);
      Serial.printf("budget = %.1f W\n", cfg.budget_dW / 10.0);
    } else if (l == "extload on" || l == "extload off") {
      cfg.extLoad = l.endsWith("on");
      ledShowLoad(!cfg.extLoad);
      if (cfg.extLoad) { pinMode(PIN_LOAD, OUTPUT); digitalWrite(PIN_LOAD, LOW); }
      Serial.printf("external load pin D4 %s\n", cfg.extLoad ? "driven" : "left alone");
    } else if (l.startsWith("l ")) {
      localEnabled = l.substring(2).toInt() != 0;
      Serial.printf("local load %s (the budget still decides)\n", localEnabled ? "enabled" : "disabled");
    } else if (l.startsWith("lprio ")) {
      cfg.lprio = (uint8_t)l.substring(6).toInt();
      Serial.printf("local load priority = %u\n", cfg.lprio);
    } else if (l.startsWith("ldraw ")) {
      cfg.ldraw_dW = (uint16_t)(l.substring(6).toFloat() * 10);
      Serial.printf("local load draw = %.1f W\n", cfg.ldraw_dW / 10.0);
    } else if (l.startsWith("add ")) {
      // Poll an address whether or not it has announced itself. Useful for a
      // node running older firmware, and for pinning a known node.
      enroll((uint8_t)l.substring(4).toInt(), 2, 25);
    } else if (l == "drop") {
      for (int a = 1; a <= MAX_LOADS; a++) loads[a].present = false;
      Serial.println("forgot all nodes");
    } else if (l.startsWith("ping")) {
      uint8_t a = l.length() > 5 ? (uint8_t)l.substring(5).toInt() : 1;
      uint8_t f[PLC_MAX_PAYLOAD]; uint8_t n = 0;
      uint32_t t0 = millis();
      sendMsg(a, MSG_PING, nullptr, 0);
      if (waitMsg(a, MSG_PONG, f, &n, plcFrameMs(4) + 300))
        Serial.printf("pong from %u in %lu ms\n", a, (unsigned long)(millis() - t0));
      else Serial.println("no pong");

    // --- bring-up diagnostics ---
    } else if (l == "self")  { plcSelfTest(Serial);
    } else if (l == "loop")  { plcLoopback(Serial);
    } else if (l == "trace") { plcTrace(Serial);
    } else if (l == "dump")  { plcDump(Serial);
    } else if (l == "fs") {
      if (!LittleFS.begin(false)) { Serial.println("filesystem will not mount"); }
      else {
        File root = LittleFS.open("/");
        size_t total = 0;
        for (File f = root.openNextFile(); f; f = root.openNextFile()) {
          Serial.printf("  %-34s %7u\n", f.path(), (unsigned)f.size());
          total += f.size();
          if (f.isDirectory()) {
            File d = LittleFS.open(f.path());
            for (File g = d.openNextFile(); g; g = d.openNextFile()) {
              Serial.printf("  %-34s %7u\n", g.path(), (unsigned)g.size());
              total += g.size();
              if (g.isDirectory()) {
                File e = LittleFS.open(g.path());
                for (File h = e.openNextFile(); h; h = e.openNextFile()) {
                  Serial.printf("  %-34s %7u\n", h.path(), (unsigned)h.size());
                  total += h.size();
                }
              }
            }
          }
        }
        Serial.printf("  total %u bytes, index.html %s\n", (unsigned)total,
                      LittleFS.exists("/index.html") ? "present" : "MISSING");
      }
    } else if (l == "pins")  { plcPins(Serial);
    } else if (l == "txtest"){ plcTxTest(Serial);
    } else if (l == "couple"){ plcCoupleTest(Serial);
    } else if (l == "probe") { plcProbe(Serial);
    } else if (l == "bench") { plcBench(Serial);
    } else if (l == "mon")   { plcMonitor(Serial);
    } else if (l == "scan")  { plcAdcScan(Serial, 3000);
    } else if (l == "cal")   { Serial.println("keying carrier 6 s"); plcCalTone(6000);
    } else if (l.startsWith("rate ")) {
      int sp = l.indexOf(' ', 5);
      uint32_t b = l.substring(5, sp > 0 ? sp : l.length()).toInt();
      uint32_t u = sp > 0 ? l.substring(sp + 1).toInt() : 0;
      if (!plcSetRate(b, u, &Serial)) Serial.println("bad rate");
    } else if (l == "stats") {
      PlcStats s = plcStats();
      Serial.printf("frames=%lu crcErr=%lu syncErr=%lu bitErr=%lu baseline=%u depth=%u\n",
                    (unsigned long)s.frames, (unsigned long)s.crcErr, (unsigned long)s.syncErr,
                    (unsigned long)s.bitErr, plcBaseline(), plcLastDepth());
    } else {
      Serial.println("identity: role power|load | id N | prio N | draw W | wifi SSID PASS | wifi on|off | extload on|off | ap | save | show | reboot");
      Serial.println("run:      b <watts> | l <0|1> | lprio N | ldraw W | add N | drop | ping [addr] | stats");
      Serial.println("bring-up: self | pins | probe | loop | trace | dump | bench | mon | scan | cal | rate <bitus> <sampus>");
    }
  }
}

void handleSerialPublic() { handleSerial(); }

// =================================================================== SETUP ==
void setup() {
  Serial.begin(115200);
  delay(400);
  esp_task_wdt_deinit();          // the sampler and the modulator both busy-wait
  randomSeed(esp_random());

  configLoad();
  for (int i = 0; i <= MAX_LOADS; i++) prioSet[i] = 0xFF;
  ledBegin();
  plcOnTick(ledTick);
  // Only touch D4 if there is actually something on it. Driving a pin that has
  // a resistor to BUS+ would sink current through the GPIO for no reason.
  if (cfg.extLoad) { pinMode(PIN_LOAD, OUTPUT); digitalWrite(PIN_LOAD, LOW); }
  ledShowLoad(!cfg.extLoad);

  plcBegin();
  Serial.printf("\n%s NODE (id %u)  %u bps  baseline=%u counts\n",
                roleName(), cfg.id, (unsigned)(1000000UL / plcBitUs()), plcBaseline());
  configPrint(Serial);
  plcSelfTest(Serial);

  if (cfg.role == ROLE_POWER && cfg.wifiOn) wifiBegin();
  else if (cfg.role == ROLE_POWER) Serial.println("wifi: off");
  Serial.println("type ? for commands");
}

void loop() {
  if (cfg.role == ROLE_POWER) {
    powerCycle();
    powerGap();
  } else {
    loadService();
    handleSerial();
  }
}
