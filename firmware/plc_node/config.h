// config.h — persisted node identity and settings.
//
// One binary runs every board. Role, address, priority and declared draw live
// in NVS and are set over serial, so adding load 2 and load 3 is `role load` +
// `id 2` + `save`, not a recompile per board. First boot guesses the role from
// the chip (S3 -> power node) so a virgin board still comes up usable.

#pragma once
#include <Arduino.h>
#include <Preferences.h>

#define ROLE_POWER 0
#define ROLE_LOAD  1

#define MAX_LOADS  8          // addresses 1..MAX_LOADS
#define ADDR_BCAST 0xFF

struct NodeConfig {
  uint8_t  role;
  uint8_t  id;                // 0 for the power node, 1..MAX_LOADS for loads
  uint8_t  prio;              // load only: 0 = most critical
  uint16_t draw_dW;           // load only: declared consumption, deciwatts
  uint16_t budget_dW;         // power only: bus budget, deciwatts
  uint8_t  lprio;             // power only: its own directly-wired load
  uint16_t ldraw_dW;          //   (priority 0 = critical, never shed)
  bool     wifiOn;            // power only: radio off entirely if false
  bool     extLoad;           // drive D4 at all? off = built-in LED shows load state
  String   ssid, pass;        // power only: empty ssid = run as access point
};

inline NodeConfig cfg;
inline Preferences prefs;

inline void configLoad() {
  prefs.begin("plcnode", false);
#if defined(CONFIG_IDF_TARGET_ESP32S3)
  const uint8_t defRole = ROLE_POWER, defId = 0;
#else
  const uint8_t defRole = ROLE_LOAD,  defId = 1;
#endif
  cfg.role      = prefs.getUChar("role", defRole);
  cfg.id        = prefs.getUChar("id", defId);
  cfg.prio      = prefs.getUChar("prio", 2);
  cfg.draw_dW   = prefs.getUShort("draw", 25);
  cfg.budget_dW = prefs.getUShort("budget", 100);
  cfg.lprio     = prefs.getUChar("lprio", 0);
  cfg.ldraw_dW  = prefs.getUShort("ldraw", 20);
  cfg.wifiOn    = prefs.getBool("wifion", true);
  cfg.extLoad   = prefs.getBool("extload", false);
  cfg.ssid      = prefs.getString("ssid", "");
  cfg.pass      = prefs.getString("pass", "");
}

inline void configSave() {
  prefs.putUChar("role", cfg.role);
  prefs.putUChar("id", cfg.id);
  prefs.putUChar("prio", cfg.prio);
  prefs.putUShort("draw", cfg.draw_dW);
  prefs.putUShort("budget", cfg.budget_dW);
  prefs.putUChar("lprio", cfg.lprio);
  prefs.putUShort("ldraw", cfg.ldraw_dW);
  prefs.putBool("wifion", cfg.wifiOn);
  prefs.putBool("extload", cfg.extLoad);
  prefs.putString("ssid", cfg.ssid);
  prefs.putString("pass", cfg.pass);
}

inline const char *roleName() { return cfg.role == ROLE_POWER ? "POWER" : "LOAD"; }

inline void configPrint(Stream &out) {
  out.printf("role=%s id=%u prio=%u draw=%.1fW budget=%.1fW wifi=%s\n",
             roleName(), cfg.id, cfg.prio, cfg.draw_dW / 10.0,
             cfg.budget_dW / 10.0, !cfg.wifiOn ? "off" : (cfg.ssid.length() ? cfg.ssid.c_str() : "(access point)"));
  out.printf("external load pin (D4): %s\n", cfg.extLoad ? "driven" : "off, built-in LED shows load");
  if (cfg.role == ROLE_POWER)
    out.printf("local load: prio=%u draw=%.1fW\n", cfg.lprio, cfg.ldraw_dW / 10.0);
}
