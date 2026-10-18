// plc_common.h — DC power-line link layer for the XIAO load-modulation bus.
//
// Physical layer: the node keys an IRFZ44N that shunts a 47R resistor across the
// bus. The extra ~106 mA through the ~1R series resistor at the source drops the
// whole downstream bus by ~88 mV. Every node watches that bus through a 10k/10k
// divider on an ADC pin, so one transmitter is heard by all receivers.
//
//   MARK  = MOSFET on  = bus pulled down
//   SPACE = MOSFET off = bus at rest
//
// Line code is Manchester (bit 1 = MARK then SPACE, bit 0 = SPACE then MARK).
// Every bit carries a mid-bit transition, so decoding never depends on an
// absolute voltage — only on which half of the bit was lower. That matters here
// because the baseline moves whenever a load switches somewhere on the bus.
//
// Frame: 16 bits of '1' (preamble) | 0x7E (sync) | len | payload[len] | crc8
// CRC-8 poly 0x07 over len+payload.

#pragma once
#include <Arduino.h>

// ---------------------------------------------------------------- pin map ---
// XIAO silkscreen labels — identical on the ESP32-S3 and the ESP32-C6, even
// though the underlying GPIO numbers differ.
// Defaults; both are settable at runtime (`rxpin` / `txpin`) so a damaged or
// otherwise unusable pin costs one jumper move rather than a firmware change.
#define PIN_PLC_RX_DEFAULT  D0   // ADC in, 10k/10k divider from BUS+
#define PIN_PLC_TX_DEFAULT  D1   // IRFZ44N gate via 320R, 10k gate pulldown
#define PIN_LOAD     D4   // IRFZ44N gate for the switched load / legacy LED

// --------------------------------------------------------------- link rate ---
// 2 ms/bit = 500 bps. Slow on purpose: 20 ADC samples per bit leaves a lot of
// margin while the hardware is unproven. Once a two-node link is solid, try
// 2000/100 for 500 bps — analogRead() has to finish inside PLC_SAMPLE_US.
#define PLC_BIT_US        2000UL
#define PLC_SAMPLE_US     60UL

#define PLC_HALF_US       (PLC_BIT_US / 2)
#define PLC_SAMPLES_BIT   ((int)(PLC_BIT_US / PLC_SAMPLE_US))   // 20
#define PLC_SAMPLES_MAX   400                                   // array guard

// Expected MARK depth in raw ADC counts. 88 mV at the bus is 44 mV at the
// divider; at 12 bits / 11 dB that is ~58 counts. The decoder re-measures the
// real depth from each preamble, so this is only the cold-start guess and the
// floor below which a dip is treated as noise. Run `cal` to check it.
#define PLC_DEPTH_DEFAULT 45
#define PLC_DEPTH_FLOOR   6

#define PLC_MAX_PAYLOAD   24
#define PLC_SYNC          0x7E

// ----------------------------------------------------------------- framing ---
static inline uint8_t plcCrc8(const uint8_t *d, size_t n) {
  uint8_t c = 0;
  while (n--) {
    c ^= *d++;
    for (int i = 0; i < 8; i++) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x07) : (uint8_t)(c << 1);
  }
  return c;
}

// Wall-clock cost of a frame, for sizing reply timeouts.

static inline uint32_t plcFrameMsImpl(uint8_t payloadLen, uint32_t bus) {
  return ((40UL + 8UL * payloadLen) * bus) / 1000UL;
}

// ------------------------------------------------------------------ state ---
struct PlcStats {
  uint32_t frames;      // CRC-good frames delivered
  uint32_t crcErr;      // framed but CRC failed
  uint32_t syncErr;     // start detected, never reached a valid sync
  uint32_t bitErr;      // Manchester violations (no mid-bit transition)
};

namespace plc {

enum RxState : uint8_t { RX_IDLE, RX_FRAME };
enum Stage   : uint8_t { ST_PRE, ST_SYNC, ST_LEN, ST_DATA, ST_CRC };

// Bit rate and sample pacing are runtime values so they can be swept live.
// Noise falls as sqrt(samples per half-bit), so these two knobs are the whole
// link budget on the firmware side.
static uint32_t bitUs    = PLC_BIT_US;
static uint32_t sampleUs = PLC_SAMPLE_US;
inline uint32_t halfUs()       { return bitUs / 2; }
inline int      perBit()       { return (int)(bitUs / sampleUs); }

static uint8_t  rxPin = PIN_PLC_RX_DEFAULT;
static uint8_t  txPin = PIN_PLC_TX_DEFAULT;

static RxState  state   = RX_IDLE;
static Stage    stage   = ST_PRE;
static float    baseline = 0;
static float    noiseEst = 8.0f;   // EWMA of |sample - baseline| while idle        // resting bus level, counts
static uint16_t depth    = PLC_DEPTH_DEFAULT;
static uint16_t lastDepth = 0;
static int      decision = 0;        // mark/space level for the frame in flight

static uint32_t nextSample = 0;
static uint32_t bitStart   = 0;
static uint32_t blankUntil = 0;      // ignore the bus after our own transmit

static uint16_t samps[PLC_SAMPLES_MAX];   // raw ADC, not thresholded
// Start-of-frame detector. It has to average enough samples that noise can't
// trip it, or the receiver locks onto a random dip and every bit after that is
// decoded at the wrong phase. The window scales with the bit rate, since the
// first MARK lasts a whole half-bit however slow we run.
#define PLC_HALF_MAX 200          // max samples in a half-bit
#define PLC_B_MAX   (3 * PLC_HALF_MAX + 2)
// Preamble correlator. The frame opens with 16 bits of '1', which in Manchester
// is a square wave at the half-bit rate — a known waveform, so acquisition
// should be a correlation, not a threshold on one dip. A boxcar of one half-bit
// is kept running; the alternating sum of the last four of those is the
// correlation, computed in O(1) per sample. Noise cannot hold that correlation
// for bit after bit, which is what a single-dip detector could never tell
// apart: it was opening 21 phantom frames a second at depth 9.
static uint16_t rawRing[PLC_HALF_MAX];
static int32_t  bRing[PLC_B_MAX];
static int      rawIdx = 0, bIdx = 0;
static long     boxSum = 0;
static int      filled = 0;
static float    corrAvg = 0;      // smoothed |correlation| — the presence detector
static long     c1 = 0, c2 = 0;   // last two correlations, for peak picking
static bool     armed = false;

inline void corrReset() { rawIdx = bIdx = 0; boxSum = 0; filled = 0; corrAvg = 0; c1 = c2 = 0; armed = false; }

inline void preReset() { corrReset(); }
static int      nSamp = 0;
static uint16_t frameMin = 0xFFFF;

static uint8_t  preOnes = 0;
static uint8_t  preBad  = 0;
static long     diffSum = 0;   // running |diff| over the frame
static int      diffCnt = 0;
static uint8_t  acc = 0, accBits = 0;
static uint8_t  buf[PLC_MAX_PAYLOAD + 2];
static uint8_t  bufLen = 0, want = 0;

static uint8_t  rxFrame[PLC_MAX_PAYLOAD];
static uint8_t  rxLen = 0;
static bool     rxReady = false;

static PlcStats stats = {0, 0, 0, 0};

// Called from plcPoll so UI (status LEDs) keeps ticking through the long
// blocking receive waits. Must be cheap: this runs every loop iteration.
static void (*tickHook)() = nullptr;

// raw-capture ring for the `dump` diagnostic
struct BitDiag { int16_t m0, m1, diff; uint8_t n, flip, stage; };
static BitDiag diag[48];
static int      diagN = 0;
static bool     diagOn = false;

static uint16_t cap[320];
static int      capN = 0;
static bool     capOn = false;

inline void abortFrame(bool countSync) {
  if (countSync) stats.syncErr++;
  state = RX_IDLE;
  preReset();
}

inline void deliver() {
  // buf = [len][payload...][crc]
  uint8_t len = buf[0];
  if (plcCrc8(buf, (size_t)len + 1) != buf[len + 1]) { stats.crcErr++; state = RX_IDLE; return; }
  memcpy(rxFrame, buf + 1, len);
  rxLen = len;
  rxReady = true;
  // Estimate the channel's modulation depth from the matched-filter output,
  // not from the lowest sample seen. frameMin tracks the deepest noise
  // excursion — with sigma ~17 counts that read 77 on a 14-count signal, which
  // then pushed the start threshold far below anything real and deafened the
  // receiver. The mean |diff| over the frame's bits is already noise-averaged
  // and is exactly the quantity the decoder needs.
  if (diffCnt > 0) {
    lastDepth = (uint16_t)(diffSum / diffCnt);
    if (lastDepth >= PLC_DEPTH_FLOOR) depth = lastDepth;
  }
  stats.frames++;
  state = RX_IDLE;
}

// Turn one bit window of samples into a bit, and nudge the bit clock so it
// stays centred on the mid-bit transition.
//
// This compares the *mean* of the two half-bits rather than thresholding each
// sample. It's a matched filter: averaging 10 samples per half cuts the noise
// by sqrt(10), and because the test is first-half-vs-second-half it needs no
// absolute threshold at all. That is what lets a few-count signal decode.
inline void decodeBit(uint32_t now) {
  const int n = nSamp;
  const int h = n / 2;
  if (n < 6) { stats.bitErr++; abortFrame(true); return; }

  long s0 = 0, s1 = 0;
  for (int i = 0; i < h; i++) s0 += samps[i];
  for (int i = h; i < n; i++) s1 += samps[i];
  const long m0 = s0 / h, m1 = s1 / (n - h);
  const long diff = m1 - m0;              // >0: first half lower = MARK first = 1

  // Demand the halves differ by a clear fraction of the channel's known depth,
  // so noise alone can't manufacture a bit.
  // The sign is the bit; the magnitude only says how much to trust it. Throwing
  // away a correctly-signed bit for being small cost us whole frames — a sync
  // byte decoded 7/8 and died on a bit of diff -1 that was the right sign. Let
  // marginal bits through and let CRC-8 be the judge of the frame.
  const long minDiff = max(1L, (long)depth / 8);
  const bool readable = (diff <= -minDiff || diff >= minDiff);
  const int  bit = (diff > 0) ? 1 : 0;

  // Locate the mid-bit transition from the cumulative sum, not from the first
  // sample to cross the midpoint. At this SNR individual samples cross the
  // midpoint constantly, so a first-crossing estimate is noise — it pinned the
  // transition at sample ~1 on every bit and dragged the clock backwards until
  // the frame fell apart. The running integral averages that away, and its
  // extremum is the maximum-likelihood transition: for a 1 the sum falls
  // through the MARK half and climbs back, so the minimum sits on the
  // transition; for a 0 it is the maximum.
  const long mid = (m0 + m1) / 2;
  long csum = 0, best = 0;
  int flip = h;
  for (int i = 0; i < n; i++) {
    csum += (long)samps[i] - mid;
    if (bit ? (csum < best) : (csum > best)) { best = csum; flip = i + 1; }
  }

  // Only steer the clock on a bit we actually believe. A weak bit's transition
  // estimate is noise, and feeding it back was throwing the window around by
  // tens of samples — the flip column read 17 and 117 where it should read h.
  const long trust = max(3L, (long)depth / 2);
  const int gain = (stage == ST_PRE) ? 2 : 4;     // pull in hard while locking
  int adj = 0;
  if (diff <= -trust || diff >= trust) {
    adj = ((flip - h) * (int)sampleUs) / gain;
    adj = constrain(adj, -(int)sampleUs * 2, (int)sampleUs * 2);
  }
  bitStart += bitUs + adj;
  nSamp = 0;

  if (diagOn && diagN < (int)(sizeof(diag) / sizeof(diag[0]))) {
    diag[diagN++] = { (int16_t)m0, (int16_t)m1, (int16_t)diff,
                      (uint8_t)n, (uint8_t)min(flip, 255), (uint8_t)stage };
  }

  if (readable) { diffSum += (diff < 0 ? -diff : diff); diffCnt++; }

  if (!readable) {
    stats.bitErr++;
    // The preamble exists to pull the bit clock into phase; a few unreadable
    // bits at the start of that are expected, not a reason to give up.
    if (stage == ST_PRE && ++preBad <= 3) return;
    abortFrame(stage != ST_PRE);
    return;
  }

  switch (stage) {
    case ST_PRE:
      if (bit) {
        if (++preOnes > 40) abortFrame(true);          // stuck on a DC dip
      } else {
        if (preOnes < 2) { abortFrame(true); return; } // acquisition lands mid-preamble
        stage = ST_SYNC; acc = 0; accBits = 1;         // this 0 is sync bit 7
      }
      break;

    case ST_SYNC:
      acc = (uint8_t)((acc << 1) | bit);
      if (++accBits == 8) {
        if (acc != PLC_SYNC) { abortFrame(true); return; }
        stage = ST_LEN; acc = 0; accBits = 0;
      }
      break;

    case ST_LEN:
      acc = (uint8_t)((acc << 1) | bit);
      if (++accBits == 8) {
        if (acc == 0 || acc > PLC_MAX_PAYLOAD) { abortFrame(true); return; }
        buf[0] = acc; bufLen = 1; want = acc;
        stage = ST_DATA; acc = 0; accBits = 0;
      }
      break;

    case ST_DATA:
      acc = (uint8_t)((acc << 1) | bit);
      if (++accBits == 8) {
        buf[bufLen++] = acc; acc = 0; accBits = 0;
        if (bufLen == (uint8_t)(want + 1)) stage = ST_CRC;
      }
      break;

    case ST_CRC:
      acc = (uint8_t)((acc << 1) | bit);
      if (++accBits == 8) { buf[bufLen++] = acc; deliver(); }
      break;
  }
  (void)now;
}

} // namespace plc

// ------------------------------------------------------------------- API ----

inline void plcBegin() {
  pinMode(plc::txPin, OUTPUT);
  digitalWrite(plc::txPin, LOW);
  analogReadResolution(12);
  analogSetPinAttenuation(plc::rxPin, ADC_11db);   // ~0..3.1 V, bus/2 = 2.5 V

  uint32_t sum = 0;
  for (int i = 0; i < 64; i++) { sum += analogRead(plc::rxPin); delayMicroseconds(200); }
  plc::baseline   = sum / 64.0f;
  plc::decision   = (int)plc::baseline - PLC_DEPTH_DEFAULT / 2;
  plc::nextSample = micros();
}

// Call this as often as possible. One ADC sample per PLC_SAMPLE_US.
inline void plcOnTick(void (*fn)()) { plc::tickHook = fn; }

inline void plcPoll() {
  if (plc::tickHook) plc::tickHook();
  uint32_t now = micros();
  if ((int32_t)(now - plc::nextSample) < 0) return;
  plc::nextSample += plc::sampleUs;
  if ((int32_t)(now - plc::nextSample) > (int32_t)(4 * plc::sampleUs))
    plc::nextSample = now + plc::sampleUs;           // we fell behind; resync

  uint16_t s = (uint16_t)analogRead(plc::rxPin);
  if (plc::capOn && plc::capN < (int)(sizeof(plc::cap) / sizeof(plc::cap[0])))
    plc::cap[plc::capN++] = s;

  if ((int32_t)(now - plc::blankUntil) < 0) {        // settling after our own TX
    plc::state = plc::RX_IDLE;
    plc::baseline += 0.25f * (s - plc::baseline);
    return;
  }

  if (plc::state == plc::RX_IDLE) {
    // Chase the resting level quickly upward, slowly downward: modulation only
    // ever pulls the bus down, so the ceiling is the honest baseline.
    if (s > plc::baseline) plc::baseline += 0.05f   * (s - plc::baseline);
    else                   plc::baseline += 0.0008f * (s - plc::baseline);
    const float dev = fabsf(s - plc::baseline);
    plc::noiseEst += 0.002f * (dev - plc::noiseEst);

    const int h = plc::perBit() / 2;
    if (h < 2 || h > PLC_HALF_MAX) return;

    // running boxcar over one half-bit
    if (plc::filled >= h) plc::boxSum -= plc::rawRing[plc::rawIdx];
    plc::rawRing[plc::rawIdx] = s;
    plc::boxSum += s;
    plc::rawIdx = (plc::rawIdx + 1) % h;

    const int bLen = 3 * h + 1;
    plc::bRing[plc::bIdx] = (int32_t)plc::boxSum;
    const int i0 = plc::bIdx;
    plc::bIdx = (plc::bIdx + 1) % bLen;
    if (plc::filled < bLen + h) { plc::filled++; return; }

    // Correlation against the preamble: +1/-1 over four consecutive half-bits.
    const int i1 = (i0 - h     + 2 * bLen) % bLen;
    const int i2 = (i0 - 2 * h + 2 * bLen) % bLen;
    const int i3 = (i0 - 3 * h + 2 * bLen) % bLen;
    const long corr = plc::bRing[i0] - plc::bRing[i1] + plc::bRing[i2] - plc::bRing[i3];

    // Noise on that sum is 2*sigma*sqrt(h); signal is 2*depth*h. Demand both a
    // statistically solid peak and a sensible fraction of the known depth.
    const float sigma  = plc::noiseEst * 1.25f;

    // |corr| swings through zero twice a bit as the window slides, so a
    // sustained-threshold test can never fire on a real preamble. Smooth the
    // rectified correlation instead: that IS steady while a preamble is
    // present, and noise cannot lift it.
    const long acorr = corr < 0 ? -corr : corr;
    plc::corrAvg += (1.0f / h) * (acorr - plc::corrAvg);

    const float sigC    = 2.0f * sigma * sqrtf((float)h);
    const float present = max(1.2f * 0.8f * sigC, 0.30f * (float)(2L * plc::depth * h));
    plc::armed = plc::corrAvg > present;

    // Phase comes from a peak of the raw correlation, which is exactly aligned
    // with a half-bit boundary.
    const long a1 = plc::c1 < 0 ? -plc::c1 : plc::c1;
    const long a2 = plc::c2 < 0 ? -plc::c2 : plc::c2;
    const bool peak = plc::armed && a1 >= a2 && a1 > acorr && a1 > (long)(0.6f * 2L * plc::depth * h);

    if (peak) {
      // corr < 0 at the peak means the newest half-bit is the low one — the
      // MARK, i.e. the first half of a bit — so the bit began one half-bit
      // ago. Otherwise we sit in a SPACE and the bit began two ago. The peak
      // itself was one sample back.
      const uint32_t back = ((plc::c1 < 0 ? (uint32_t)h : (uint32_t)(2 * h)) + 1) * plc::sampleUs;
      plc::state    = plc::RX_FRAME;
      plc::stage    = plc::ST_PRE;
      plc::bitStart = now - back;
      plc::nSamp    = 0;
      plc::preOnes  = 0;
      plc::preBad   = 0;
      plc::diffSum  = 0;
      plc::diffCnt  = 0;
      plc::frameMin = s;
      plc::c1 = plc::c2 = 0;
      plc::armed = false;
    } else {
      plc::c2 = plc::c1;
      plc::c1 = corr;
    }
    return;
  }

  // RX_FRAME: freeze the baseline, slice against the frame's own decision level.
  // Close the bit window before filing this sample, so a sample that lands on
  // the boundary counts toward the next bit instead of smearing into this one.
  if ((int32_t)(now - plc::bitStart) >= (int32_t)(plc::bitUs - plc::sampleUs / 2)) {
    plc::decodeBit(now);
    if (plc::state != plc::RX_FRAME) return;      // delivered, or gave up
  }
  if (s < plc::frameMin) plc::frameMin = s;
  if (plc::nSamp < PLC_SAMPLES_MAX) plc::samps[plc::nSamp++] = s;
}

static inline uint32_t plcFrameMs(uint8_t payloadLen) { return plcFrameMsImpl(payloadLen, plc::bitUs); }

// Change the link rate live. Slower bits and tighter sampling both buy noise
// rejection, at the cost of throughput and ADC headroom respectively.
inline bool plcSetRate(uint32_t newBitUs, uint32_t newSampleUs, Stream *out = nullptr) {
  if (newSampleUs < 20 || newBitUs < 4 * newSampleUs) return false;
  if ((int)(newBitUs / newSampleUs) > PLC_SAMPLES_MAX) return false;
  plc::bitUs = newBitUs; plc::sampleUs = newSampleUs;
  plc::state = plc::RX_IDLE; plc::nextSample = micros(); plc::preReset();
  if (out) out->printf("rate: %lu us/bit (%lu bps), %lu us/sample, %d samples/bit, %d per half\n",
                       (unsigned long)newBitUs, 1000000UL / newBitUs,
                       (unsigned long)newSampleUs, plc::perBit(), plc::perBit() / 2);
  return true;
}

inline void plcSetPins(uint8_t rx, uint8_t tx) {
  plc::rxPin = rx; plc::txPin = tx;
  pinMode(plc::txPin, OUTPUT); digitalWrite(plc::txPin, LOW);
  pinMode(plc::rxPin, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(plc::rxPin, ADC_11db);
  plc::state = plc::RX_IDLE; plc::nextSample = micros(); plc::preReset();
}
inline uint8_t plcRxPin() { return plc::rxPin; }
inline uint8_t plcTxPin() { return plc::txPin; }

inline uint32_t plcBitUs()    { return plc::bitUs; }
inline uint32_t plcSampleUs() { return plc::sampleUs; }

inline bool plcAvailable() { return plc::rxReady; }

inline uint8_t plcRead(uint8_t *dst, uint8_t maxLen) {
  if (!plc::rxReady) return 0;
  uint8_t n = min(plc::rxLen, maxLen);
  memcpy(dst, plc::rxFrame, n);
  plc::rxReady = false;
  return n;
}

inline PlcStats plcStats()      { return plc::stats; }
inline uint16_t plcBaseline()   { return (uint16_t)plc::baseline; }
inline uint16_t plcLastDepth()  { return plc::lastDepth; }

// --- transmit -----------------------------------------------------------
// Blocking and busy-waited: at 250 bps a frame ties the CPU up for a few
// hundred ms. Fine for a polled bus, and it keeps the bit timing honest.

namespace plc {
static bool loopback = false;

// In loopback we keep sampling while we transmit, so the node decodes its own
// carrier off the bus. That exercises framing, Manchester, the matched filter
// and the CRC with a single board and whatever signal depth the bus actually
// has.
inline void waitUntil(uint32_t t) {
  if (loopback) { while ((int32_t)(micros() - t) < 0) plcPoll(); }
  else          { while ((int32_t)(micros() - t) < 0) { /* spin */ } }
}

inline void sendBit(uint8_t b, uint32_t &t) {
  digitalWrite(plc::txPin, b ? HIGH : LOW);   // first half: MARK for 1
  t += halfUs(); waitUntil(t);
  digitalWrite(plc::txPin, b ? LOW : HIGH);   // second half: the mid-bit flip
  t += halfUs(); waitUntil(t);
}

inline void sendByte(uint8_t v, uint32_t &t) {
  for (int i = 7; i >= 0; i--) sendBit((v >> i) & 1, t);
}
} // namespace plc

// Returns false if the bus never went quiet (someone else is talking).
inline bool plcSend(const uint8_t *payload, uint8_t len, uint32_t lbtMs = 300) {
  if (len == 0 || len > PLC_MAX_PAYLOAD) return false;

  uint32_t deadline = millis() + lbtMs;
  while (plc::state != plc::RX_IDLE && (int32_t)(millis() - deadline) < 0) plcPoll();
  if (plc::state != plc::RX_IDLE) return false;

  uint8_t crc_in[PLC_MAX_PAYLOAD + 1];
  crc_in[0] = len;
  memcpy(crc_in + 1, payload, len);
  uint8_t crc = plcCrc8(crc_in, (size_t)len + 1);

  uint32_t t = micros();
  for (int i = 0; i < 16; i++) plc::sendBit(1, t);   // preamble
  plc::sendByte(PLC_SYNC, t);
  plc::sendByte(len, t);
  for (uint8_t i = 0; i < len; i++) plc::sendByte(payload[i], t);
  plc::sendByte(crc, t);

  digitalWrite(plc::txPin, LOW);
  if (!plc::loopback) {
    plc::blankUntil = micros() + 2 * plc::bitUs;      // let the bus settle
    plc::nextSample = micros();
  }
  return true;
}

// --- bring-up helpers ---------------------------------------------------

// Key a 50% square wave so the other node (or a meter) can see the real depth.
inline void plcCalTone(uint32_t ms, uint32_t halfUs = 50000) {
  uint32_t end = millis() + ms;
  while ((int32_t)(millis() - end) < 0) {
    digitalWrite(plc::txPin, HIGH); delayMicroseconds(halfUs);
    digitalWrite(plc::txPin, LOW);  delayMicroseconds(halfUs);
  }
  digitalWrite(plc::txPin, LOW);
  plc::blankUntil = micros() + 4 * plc::bitUs;
  plc::nextSample = micros();
}

// Raw ADC min/max/mean — point this at the bus while the far node runs `cal`.
inline void plcAdcScan(Stream &out, uint32_t ms = 2000) {
  uint32_t end = millis() + ms;
  uint32_t n = 0, sum = 0;
  uint16_t lo = 0xFFFF, hi = 0;
  while ((int32_t)(millis() - end) < 0) {
    uint16_t s = (uint16_t)analogRead(plc::rxPin);
    lo = min(lo, s); hi = max(hi, s); sum += s; n++;
    delayMicroseconds(plc::sampleUs);
  }
  out.printf("ADC n=%lu  min=%u  max=%u  mean=%lu  swing=%d counts (~%d mV at the pin)\n",
             (unsigned long)n, lo, hi, (unsigned long)(sum / max(1UL, n)),
             (int)(hi - lo), (int)((hi - lo) * 3100L / 4095L));
  out.printf("  -> set PLC_DEPTH_DEFAULT near %d if that swing is the far node's carrier\n",
             (int)(hi - lo));
  plc::nextSample = micros();
}

// Live bus monitor: per-window min/max until you send any character. Start this
// on the listening node, then run `cal` on the other one — the swing that
// appears is your real MARK depth.
inline void plcMonitor(Stream &out, uint32_t windowMs = 250) {
  out.println("monitoring bus — send any character to stop");
  while (!out.available()) {
    uint32_t end = millis() + windowMs;
    uint16_t lo = 0xFFFF, hi = 0;
    uint32_t n = 0, sum = 0;
    while ((int32_t)(millis() - end) < 0) {
      uint16_t s = (uint16_t)analogRead(plc::rxPin);
      lo = min(lo, s); hi = max(hi, s); sum += s; n++;
      delayMicroseconds(plc::sampleUs);
    }
    int swing = (int)(hi - lo);
    char bar[41];
    int w = constrain(swing / 3, 0, 40);
    memset(bar, '#', w); bar[w] = 0;
    out.printf("min=%4u max=%4u mean=%4lu swing=%3d  %s\n",
               lo, hi, (unsigned long)(sum / max(1UL, n)), swing, bar);
  }
  while (out.available()) out.read();
  plc::nextSample = micros();
}

// Self-test: key our own shunt and watch our own divider. Works with a single
// board on the bench, and it exercises the whole analog chain at once — gate
// drive, MOSFET, 47R, the series resistor, and the divider. A node sees its own
// modulation because its shunt and its divider are both downstream of the
// series resistor; if the depth comes back ~0 the bus is being fed from the
// wrong side of that resistor, or the MOSFET isn't turning on.
inline long plcSelfTest(Stream &out, int cycles = 20, uint32_t settleUs = 2000) {
  const int M = 12;                       // samples per phase, after settling
  uint32_t sumOff = 0, sumOn = 0;
  uint16_t loOn = 0xFFFF, hiOff = 0;

  for (int k = 0; k < cycles; k++) {
    digitalWrite(plc::txPin, LOW);
    delayMicroseconds(settleUs);
    for (int i = 0; i < M; i++) {
      uint16_t s = (uint16_t)analogRead(plc::rxPin);
      sumOff += s; hiOff = max(hiOff, s);
      delayMicroseconds(100);
    }
    digitalWrite(plc::txPin, HIGH);
    delayMicroseconds(settleUs);
    for (int i = 0; i < M; i++) {
      uint16_t s = (uint16_t)analogRead(plc::rxPin);
      sumOn += s; loOn = min(loOn, s);
      delayMicroseconds(100);
    }
  }
  digitalWrite(plc::txPin, LOW);

  long mOff = sumOff / (cycles * M), mOn = sumOn / (cycles * M);
  long depth = mOff - mOn;
  out.printf("self-test: shunt OFF mean=%ld   shunt ON mean=%ld   depth=%ld counts (~%ld mV at the pin)\n",
             mOff, mOn, depth, depth * 3100L / 4095L);
  if (depth < -20)
    out.println("  D0 IS FLOATING — the reading goes UP when the shunt is keyed, which is crosstalk\n"
                "  from the D1 gate drive, not a bus. D0 is not connected to the divider junction.");
  else if (mOff < 200)
    out.println("  BUS LOOKS DEAD — divider reading near 0. No 5 V on BUS+, or D0 isn't on the divider junction.");
  else if (depth < 8)
    out.println("  NO MODULATION — MOSFET not switching at 3.3 V, 47R open, or this node's divider\n"
                "  sits upstream of the series resistor (so it can't see its own current).");
  else if (depth < PLC_DEPTH_FLOOR)
    out.println("  WEAK — raise the series resistance or lower the shunt before trusting the link.");
  else
    out.println("  OK");

  // Adopt the measured depth as the detection threshold. The decoder refines it
  // from every preamble anyway; this just makes the *first* frame detectable
  // without anyone editing a constant per board.
  if (depth >= PLC_DEPTH_FLOOR && depth < 2000) {
    plc::depth = (uint16_t)depth;
    out.printf("  detection depth set to %ld counts\n", depth);
  }

  plc::blankUntil = micros() + 4 * plc::bitUs;
  plc::nextSample = micros();
  return depth;
}

// Transmit a known frame and try to decode it on the same board. Proves the
// whole stack end to end without a second node, at the real bus amplitude.
inline bool plcLoopback(Stream &out) {
  static const uint8_t pay[9] = {'L','O','O','P','B','A','C','K',0x5A};
  plc::rxReady = false;
  plc::state   = plc::RX_IDLE;
  const uint32_t before = plc::stats.frames;
  const uint32_t bErr0 = plc::stats.bitErr, sErr0 = plc::stats.syncErr, cErr0 = plc::stats.crcErr;

  plc::loopback = true;
  bool sent = plcSend(pay, sizeof(pay));
  uint32_t end = millis() + 60;                      // let the final bit close
  while ((int32_t)(millis() - end) < 0) plcPoll();
  plc::loopback = false;
  plc::nextSample = micros();

  if (!sent) { out.println("loopback: bus busy, nothing sent"); return false; }

  bool ok = false;
  if (plc::stats.frames > before && plc::rxReady && plc::rxLen == sizeof(pay)) {
    ok = memcmp(plc::rxFrame, pay, sizeof(pay)) == 0;
  }
  plc::rxReady = false;

  out.printf("loopback: %s   depth=%u  bitErr+%lu syncErr+%lu crcErr+%lu\n",
             ok ? "PASS — frame decoded intact" : "FAIL",
             plcLastDepth(),
             (unsigned long)(plc::stats.bitErr  - bErr0),
             (unsigned long)(plc::stats.syncErr - sErr0),
             (unsigned long)(plc::stats.crcErr  - cErr0));
  if (!ok)
    out.println("  (bitErr means halves too close to call; syncErr means the preamble\n"
                "   was found but the frame fell apart; crcErr means bits flipped)");
  return ok;
}

// Capture the raw ADC stream while we transmit a frame, then print it. This is
// the ground truth: if the carrier isn't visible here, no decoder will find it.
inline void plcDump(Stream &out) {
  static const uint8_t pay[4] = {'D','M','P',0x5A};
  plc::capN = 0; plc::capOn = true;
  plc::state = plc::RX_IDLE;
  plc::loopback = true;
  plcSend(pay, sizeof(pay));
  uint32_t end = millis() + 30;
  while ((int32_t)(millis() - end) < 0) plcPoll();
  plc::loopback = false;
  plc::capOn = false;
  plc::nextSample = micros();

  uint16_t lo = 0xFFFF, hi = 0;
  for (int i = 0; i < plc::capN; i++) { lo = min(lo, plc::cap[i]); hi = max(hi, plc::cap[i]); }
  out.printf("dump: %d samples @ %luus, %d per bit. min=%u max=%u span=%d\n",
             plc::capN, (unsigned long)PLC_SAMPLE_US, PLC_SAMPLES_BIT, lo, hi, (int)(hi - lo));
  for (int i = 0; i < plc::capN; i++) {
    out.printf("%u%c", plc::cap[i], ((i % 20) == 19) ? '\n' : ',');
  }
  out.println();
}

// How fast can analogRead() go on this part? Sets the floor for sampleUs.
inline void plcBench(Stream &out) {
  const int N = 2000;
  uint32_t t0 = micros();
  volatile uint32_t sink = 0;
  for (int i = 0; i < N; i++) sink += (uint32_t)analogRead(plc::rxPin);
  uint32_t dt = micros() - t0;
  out.printf("analogRead: %.1f us each (%d reads in %lu us)\n",
             (double)dt / N, N, (unsigned long)dt);
  plc::nextSample = micros();
}

// Same as loopback, but records what the decoder computed for each bit window.
// m0/m1 are the two half-bit means; diff is what the bit decision rides on.
inline void plcTrace(Stream &out) {
  static const uint8_t pay[4] = {'T','R','C',0x5A};
  plc::diagN = 0; plc::diagOn = true;
  plc::state = plc::RX_IDLE; plc::rxReady = false;
  plc::loopback = true;
  plcSend(pay, sizeof(pay));
  uint32_t end = millis() + 40;
  while ((int32_t)(millis() - end) < 0) plcPoll();
  plc::loopback = false; plc::diagOn = false;
  plc::nextSample = micros();

  out.printf("trace: depth=%u minDiff=%ld  samples/bit=%d  (stage 0=PRE 1=SYNC 2=LEN 3=DATA 4=CRC)\n",
             plc::depth, max(2L, (long)plc::depth / 4), plc::perBit());
  out.println("  bit   n  flip    m0    m1   diff  stage");
  for (int i = 0; i < plc::diagN; i++) {
    plc::BitDiag &d = plc::diag[i];
    out.printf("  %3d %3u  %4u  %5d %5d  %5d  %u\n", i, d.n, d.flip, d.m0, d.m1, d.diff, d.stage);
  }
}

// Read every spare analog pin. If the divider output ended up on a neighbour,
// this finds it immediately instead of guessing at the breadboard. Skips D1
// and D4 because those are driven outputs.
inline void plcPins(Stream &out) {
  const uint8_t pins[] = {D0, D2, D3, D5};
  const char   *names[] = {"D0 (rx)", "D2", "D3", "D5"};
  out.println("pin      counts    approx V at pin   (divider on a 5V bus should read ~2.5V / ~3150)");
  for (int i = 0; i < 4; i++) {
    pinMode(pins[i], INPUT);
    analogSetPinAttenuation(pins[i], ADC_11db);
    uint32_t sum = 0;
    for (int k = 0; k < 32; k++) { sum += analogRead(pins[i]); delayMicroseconds(100); }
    uint32_t c = sum / 32;
    out.printf("%-8s %5lu     %.2f V%s\n", names[i], (unsigned long)c,
               c * 3.1 / 4095.0, c >= 4090 ? "   <- railed, above full scale" : "");
  }
  plc::nextSample = micros();
}

// Probe what is actually attached to a pin, using the chip's own ~45k internal
// pull-ups as a known reference. A pin tied to an external network sits where
// the divider between that network and the internal pull puts it; a pin with
// nothing on it goes to the rail. This is how to tell "the wire isn't there"
// from "the wire is there but the circuit isn't working" without a meter.
inline void plcProbe(Stream &out) {
  struct P { uint8_t pin; const char *name; const char *expect; };
  const P pins[] = {
    { D0, "D0 rx  ", "~3200 (10k/10k divider on a live bus holds it)" },
    { D1, "D1 gate", "~800  (320R + 10k gate pulldown against the 45k pull-up)" },
    { D2, "D2     ", "~4095 if nothing attached" },
    { D3, "D3     ", "~4095 if nothing attached" },
    { D5, "D5     ", "~4095 if nothing attached" }
  };
  out.println("pin       pull-up   pull-down   verdict");
  for (unsigned i = 0; i < sizeof(pins) / sizeof(pins[0]); i++) {
    uint32_t up = 0, dn = 0;
    pinMode(pins[i].pin, INPUT_PULLUP);
    analogSetPinAttenuation(pins[i].pin, ADC_11db);
    delay(5);
    for (int k = 0; k < 32; k++) { up += analogRead(pins[i].pin); delayMicroseconds(100); }
    pinMode(pins[i].pin, INPUT_PULLDOWN);
    delay(5);
    for (int k = 0; k < 32; k++) { dn += analogRead(pins[i].pin); delayMicroseconds(100); }
    up /= 32; dn /= 32;

    const char *verdict;
    if (up > 3900 && dn < 200)      verdict = "FLOATING — nothing connected to this pin";
    else if (up > 3900)             verdict = "pulled high by something external";
    else if (up - dn < 150)         verdict = "held hard by an external source (low impedance)";
    else                            verdict = "external network present";
    out.printf("%s  %5lu     %5lu     %s\n", pins[i].name,
               (unsigned long)up, (unsigned long)dn, verdict);
  }
  out.println("  expected: D0 ~3200, D1 ~800 (gate network), unused pins ~4095/0");
  // leave the transmit pin driving again
  pinMode(plc::txPin, OUTPUT);
  digitalWrite(plc::txPin, LOW);
  pinMode(plc::rxPin, INPUT);
  analogSetPinAttenuation(plc::rxPin, ADC_11db);
  plc::nextSample = micros();
}

// Prove the transmit pin is really toggling, and on the GPIO we think it is.
// Reading the pad back with the ADC catches a wrong pin number, a pin left as
// an input, or a drive that never happens — all of which would look exactly
// like "no modulation" from the bus side.
inline void plcTxTest(Stream &out) {
  out.printf("rx = D0 -> GPIO%u,  tx = D1 -> GPIO%u\n", plc::rxPin, plc::txPin);

  // Read the pad back with digitalRead, not analogRead: taking an ADC reading
  // re-points the pad at the ADC and switches the output driver off, so an
  // analogRead of a pin you are driving always reports 0 whatever the hardware
  // is doing. On ESP32 Arduino, OUTPUT keeps the input buffer enabled, so
  // digitalRead here is the actual pad level.
  pinMode(plc::txPin, OUTPUT);
  int lowReads = 0, highReads = 0;
  for (int i = 0; i < 64; i++) {
    digitalWrite(plc::txPin, LOW);  delayMicroseconds(200); lowReads  += digitalRead(plc::txPin);
    digitalWrite(plc::txPin, HIGH); delayMicroseconds(200); highReads += digitalRead(plc::txPin);
  }
  digitalWrite(plc::txPin, LOW);
  out.printf("gate pad: reads high %d/64 when driven LOW, %d/64 when driven HIGH\n",
             lowReads, highReads);

  if (highReads < 48)
    out.println("  GATE HELD LOW — driving the pin high does not raise the pad.\n"
                "  Something external is sinking it: a short to GND, or the gate\n"
                "  resistor going somewhere other than the gate.");
  else if (lowReads > 16)
    out.println("  GATE HELD HIGH — something is holding the pin up.");
  else
    out.println("  OK — the pin swings both ways, so the firmware drives it correctly.\n"
                "  Any missing modulation is past this pin: gate wire, MOSFET, 47R, or\n"
                "  the series path between the 5V pin and BUS+.");
  plc::nextSample = micros();
}

// D0 (GPIO1) and D1 (GPIO2) are adjacent, and we have already seen the gate
// drive couple into the receive pin once. Capacitive coupling dies in
// microseconds; a real resistive dip lasts as long as the shunt is on. Running
// the same measurement at two settle times tells them apart, with no meter.
inline void plcCoupleTest(Stream &out) {
  out.println("short settle (2 ms) — includes any coupling from the gate edge:");
  long fast = plcSelfTest(out, 20, 2000);
  out.println("long settle (60 ms) — coupling has long since decayed:");
  long slow = plcSelfTest(out, 8, 60000);
  out.printf("\nfast=%ld  slow=%ld counts\n", fast, slow);
  if (slow < 3 && fast > 4)
    out.println("  THE DIP IS COUPLING, NOT MODULATION. The shunt is passing no\n"
                "  current at all — gate wire, MOSFET or 47R is open. The series\n"
                "  resistor is not the problem.");
  else if (slow >= 3)
    out.printf("  Real modulation of %ld counts survives the long settle, so current\n"
               "  does flow. At 106 mA that is only %ld milliohms of series resistance.\n", slow, slow * 757L * 2 / 106000L * 1000L / 1000L);
  else
    out.println("  Both tiny — nothing is modulating the bus either way.");
}
