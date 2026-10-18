# Bringing up the power-line bus

A record of getting data to travel over the power conductors, written down
because most of a day went into two faults that will happen again.

The link is Manchester-coded on/off keying of a resistive shunt. A node pulls
~106 mA through a series resistor at the source; that current becomes a voltage
dip the whole bus can see. Everything below is about the gap between that
sentence and a working link.

## What the hardware is

Four Seeed XIAO boards on two wires. One ESP32-S3 is the power node; ESP32-C6
boards are load adapters. Per node: a 10k/10k divider from BUS+ to an ADC pin,
and an IRFZ44N switching a 47 Ω shunt from BUS+ to ground. A series resistor
between the source's `5V` pin and BUS+ turns shunt current into bus voltage.

## The numbers that matter

| quantity | value |
|---|---|
| ADC noise, per sample | **17.4 counts RMS** |
| modulation depth, working | 30–335 counts |
| modulation depth, floor | ~13 counts — below this nothing decodes |
| `analogRead()` | 46.6 µs, so 60 µs is the sampling floor |
| link rate | 125 bps, 133 samples/bit |

The ADC being this noisy is the fact the whole design bends around. A single
sample tells you almost nothing; everything works by averaging.

## Fault 1 — the receive divider ended up upstream of the series resistor

**Cost: about four hours.**

After tidying the breadboard, modulation depth fell from 44 counts to 5–11 and
would not come back. Every component was present and every pin read a plausible
voltage: `D0` sat at 2.37 V, exactly what a 10k/10k divider on a 5 V bus should
give.

What made it hard was that the symptom survived every change. Adding a series
resistor did nothing. Doubling it did nothing. Removing resistors did nothing.
Each time, the depth stayed between 5 and 11.

The explanation: the divider's top 10 kΩ had been moved to the `5V` pin rather
than BUS+. It was measuring USB VBUS — upstream of the series resistor — so the
only resistance in the measured path was the USB cable and some trace, about
72 mΩ. That is exactly the 10 counts we kept reading at 106 mA.

**The giveaway, in hindsight:** changing a component's value and seeing no
change in the reading means the component is not in the measured path. That is
worth more than any amount of reasoning about what the value should be. It took
the user pulling resistors out and reporting that the downstream node lost power
— proving the resistors were the only power path — to force the realisation that
the *measurement*, not the *path*, was in the wrong place.

The firmware had been printing it as a possible cause from the start:

```
NO MODULATION — MOSFET not switching at 3.3 V, 47R open, or this node's divider
sits upstream of the series resistor (so it can't see its own current).
```

Moving one wire took depth from 10 to **334**.

## Fault 2 — the web server cannot share a core with the sampler

**Cost: about thirty minutes, but the symptom was genuinely strange.**

With the link working, nodes could be polled and would answer perfectly, but
they could never be *discovered* — an unenrolled node announcing itself was
never heard.

That asymmetry is the clue. A reply arrives inside a tight `waitMsg` loop that
does nothing but sample. An announcement arrives during the idle gap between
poll cycles, and that gap was also calling `server.handleClient()`, which blocks
for milliseconds with the access point up. A 60 µs sample cadence does not
survive that, and the preamble correlator loses lock.

Moving the web server to a task pinned to core 0, next to the Wi-Fi stack, fixed
it. Discovery now works with the radio on.

## Things that looked like faults and were not

**`D0`, `D2` and `D3` all railed at 4095.** Three pins reading full scale looks
like a short to 5 V. It was floating inputs: pins with a resistor to BUS+ and
nothing pulling them down drift up and the ADC clips. Harmless, but it masked
the real divider fault underneath for a while.

**A self-test reporting `gate pad: LOW=0 HIGH=0`.** This looked like the gate
being held down. It was the test being wrong: `analogRead()` re-points the pad
at the ADC and switches the output driver off, so reading back a pin you are
driving always returns 0. `digitalRead()` is the correct instrument, and it
showed the pin swinging 0/64 and 64/64 as it should.

**Depth wandering between 3 and 44 all day.** Attributed at one point to the
IRFZ44N sitting near its threshold, since it is not a logic-level part and is
being driven at 3.3 V. That turned out to be wrong — a 60 ms settle test showed
the dip was real DC current, not a switching artifact, so the MOSFET was fine.
The wandering was the divider fault plus repeated rewiring.

## Decoder changes that were necessary

Three, each found by instrumenting rather than reasoning.

**Bits are decided by comparing the means of the two half-bits**, not by
thresholding samples. Averaging N samples cuts noise by √N, and a
first-half-against-second-half test needs no absolute threshold — which matters
because the baseline moves whenever a load switches.

**The mid-bit transition is found from a cumulative sum.** The first version
used the first sample to cross the midpoint. At this SNR samples cross the
midpoint constantly, so it reported sample ~1 on every bit and dragged the clock
backwards by the full clamp each time. The all-ones preamble is self-similar so
it survived that, and frames died at the first sync bit. The integral's extremum
is the maximum-likelihood transition and is stable.

**Channel depth is measured from the matched-filter output**, not the lowest
sample in a frame. With σ ≈ 17 the minimum sample is just the deepest noise
excursion: it read 77 on a 14-count signal, which pushed the detection threshold
below anything real and deafened the receiver after its first success.

**Acquisition correlates against the preamble.** The frame opens with 16 bits of
'1', which in Manchester is a square wave at the half-bit rate — a known
waveform. The original single-dip detector opened 21 phantom frames per second
at depth 9. A running boxcar over one half-bit, with the alternating sum of the
last four, gives the correlation in O(1) per sample. One subtlety: that
correlation *oscillates* through zero twice per bit as the window slides, so a
sustained-threshold test can never fire. Smoothing the rectified correlation is
the presence detector; a peak of the raw correlation gives the phase. False
triggers went from 21/s to 0.8/s.

## Tools worth having

Each of these was written to answer a question that could not be answered by
staring at the circuit.

| command | what it answers |
|---|---|
| `self` | does this node hear its own modulation? Tests gate, MOSFET, shunt, series resistor and divider in one shot. Runs at boot |
| `loop` | transmit a frame and decode it on the same board — the whole stack, one node |
| `trace` | per-bit half-bit means and recovered phase. This is what found the clock-recovery bug |
| `dump` | raw ADC samples during a transmission. Correlating this offline proved the carrier existed when nothing would decode |
| `couple` | same measurement at 2 ms and 60 ms settle — separates capacitive coupling from real current |
| `txtest` | reads the gate pad back with `digitalRead` to prove the pin is driven |
| `pins` | voltage on every spare ADC pin — finds a divider wired to the wrong pin |
| `bench` | `analogRead` timing, which sets the sampling floor |
| `rate a b` | change bit period and sample period live, no reflash |

## What we would do differently

**Put a real series resistor in from the start.** For most of the day the signal
came from the parasitic resistance of jumper wires — 0.45 Ω one moment, 0.13 Ω
after a tidy-up. That number is not designed, so it changes whenever anyone
touches the board, and several hours went into establishing which value was
current rather than fixing anything.

**Version the firmware from commit one.** There was a point where reverting to
"the build that worked" was the obvious move and it was not possible, because
nothing was in git.

**Trust a controlled experiment over a chain of inference.** The single most
informative moment was changing the resistor value and seeing the reading not
move. One deliberate change beat hours of reasoning from a single measurement.

**Read your own error messages.** The self-test named the actual fault, in
plain words, every time it ran, for four hours.
