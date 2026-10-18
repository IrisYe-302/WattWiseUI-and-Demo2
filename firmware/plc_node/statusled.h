// statusled.h — the XIAO's built-in LED as a link indicator.
//
// The external LED on D4 is the *load*. This one is the *link*, so you can see
// at a glance which boards are talking without a serial monitor — and during
// the demo the blinks line up with real traffic on the power wires, which is
// the whole point being made.
//
//   solid while lit      a frame is going out of this node right now
//   one 120 ms flash     a frame arrived and passed CRC
//   blip every 2 s       link healthy, nothing to say
//   fast 5 Hz blink      link lost (it worked, now it doesn't)
//   slow 1 Hz blink      searching — never heard from the other end
//
// The XIAO user LED is active low on both the S3 (GPIO21) and C6 (GPIO15).

#pragma once
#include <Arduino.h>

#ifndef LED_BUILTIN
#define LED_BUILTIN 21
#endif

enum LedState : uint8_t { LED_SEARCHING, LED_HEALTHY, LED_LOST };

namespace led {
static LedState state = LED_SEARCHING;
static uint32_t flashUntil = 0;     // RX flash
static bool     txHold = false;     // solid while transmitting
static bool     lit = false;
static bool     showLoad = false;   // base pattern reflects the load, not the link
static bool     loadOn = false;

inline void write(bool on) {
  if (on == lit) return;            // don't hammer the GPIO every tick
  lit = on;
  digitalWrite(LED_BUILTIN, on ? LOW : HIGH);   // active low
}
} // namespace led

inline void ledBegin() {
  pinMode(LED_BUILTIN, OUTPUT);
  led::lit = true;                  // force the first write through
  led::write(false);
}

inline void ledState(LedState s)  { led::state = s; }
inline void ledRxFlash()          { led::flashUntil = millis() + 120; }
inline void ledTx(bool on)        { led::txHold = on; if (on) led::write(true); }

// With no external LED on D4, the built-in one carries the load state as its
// base pattern and still blips for traffic: lit = load running, dark = shed.
inline void ledShowLoad(bool enable) { led::showLoad = enable; }
inline void ledLoad(bool on)         { led::loadOn = on; }

// Cheap enough to call from every plcPoll.
inline void ledTick() {
  if (led::txHold) { led::write(true); return; }

  const uint32_t now = millis();
  if ((int32_t)(now - led::flashUntil) < 0) { led::write(true); return; }

  switch (led::state) {
    case LED_HEALTHY:
      // inverted blip when the load is on, so both states stay distinguishable
      led::write(led::showLoad && led::loadOn ? ((now % 2000) >= 40)
                                              : ((now % 2000) < 40));
      break;
    case LED_LOST:      led::write((now % 200)  < 100);  break;   // fast
    case LED_SEARCHING: led::write((now % 1000) < 500);  break;   // slow
  }
}
