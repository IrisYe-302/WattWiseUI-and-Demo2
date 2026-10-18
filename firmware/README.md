# Power-line bus — two-node bring-up

## Status (measured 2026-10-17, XIAO ESP32-S3 + ESP32-C6)

Two-node link working end to end with wifi up:

- Load announces itself, master enrolls it, 30+ consecutive polls, `miss=0`,
  `crc=0`, round trip 1.58 s at 125 bps
- Budget 10 W -> load runs; 1 W (below its declared 2.5 W) -> sheds within one
  poll; back to 10 W -> restored
- Modulation depth 335 counts with two 10 ohm in parallel (5 ohm) as the series
  element

Still to do: loads 2 and 3, the live-unplug fail-safe test, and pointing the
WattWiseUI bridge at the real bus.

### Two faults that cost most of a day, worth not repeating

**The receive divider must tap downstream of the series resistor.** It was
moved to the `5V` pin during a tidy-up, so it measured USB VBUS rather than the
bus. Everything looked plausible — the pin read a healthy 2.4 V — but the depth
sat at 5-11 counts no matter what, because the only resistance in the measured
path was the USB cable's 72 milliohms. Changing the series resistor had no
effect, which is the giveaway: if altering a component does not move the
reading, the component is not in the measured path. `self` had been printing
this as its third possible cause the whole time.

**The web server cannot share a core with the sampler.** `server.handleClient()`
blocks for milliseconds, which punches holes in a 60 us sample cadence and
destroys the correlator's lock. The symptom was oddly specific: nodes could be
polled successfully but never heard announcing themselves, because replies
arrive inside a tight `waitMsg` loop while announcements only ever arrive during
the gap where the server was being serviced. The web server now runs in a task
pinned to core 0 alongside the wifi stack.

One binary runs every board. Role and address live in flash, so adding a node
is three serial commands, not a recompile:

```bash
arduino-cli compile -b esp32:esp32:XIAO_ESP32S3 plc_node --upload -p /dev/cu.usbmodemXXXX
arduino-cli compile -b esp32:esp32:XIAO_ESP32C6 plc_node --upload -p /dev/cu.usbmodemYYYY
```

A virgin board guesses from the chip (S3 -> power node, anything else -> load 1).
To set up load 2:

```
role load
id 2
prio 3
draw 2.5
save
reboot
```

## Roles and discovery

The power node (id 0) owns the bus. It polls each load it knows about, and a
load answers only its own address, so enrolled traffic cannot collide.

Discovery is by announcement, not scanning. A load that has not been polled for
~1.2 s broadcasts a `HELLO` carrying its priority and declared draw, with random
backoff and listen-before-talk. The master enrolls it and polls it from the next
cycle. Scanning every possible address would cost a full reply timeout per empty
slot and take tens of seconds; announcing takes a few.

The master stays receptive during poll transactions, not just in the gap between
them — a `HELLO` that arrives mid-transaction still enrolls the sender. Without
that it listens only ~20% of the time and a board plugged in live takes ~15 s to
appear.

Three missed polls drops a node, releases its budget and lets whatever was shed
come back.

## Power budget

Every cycle the master allocates the budget by priority, lowest number first,
until it runs out. The controller's own directly-wired load competes on the same
ladder at priority 0 by default, so it is the one that survives.

That local load is a GPIO and a MOSFET on the controller board — it has no
transceiver and demonstrates nothing about power-line communication. Do not
pitch it as the legacy-appliance story; the load modules are that story, since
each is an adapter with a transceiver in front of a load that has no
intelligence of its own. What the local load is good for is being visibly
critical: drop the budget and the remote loads go dark one by one while it stays
lit. The reservation is real — it genuinely reduces what the bus nodes share.

## Status LEDs

The external LED on `D4` is the load. The XIAO's built-in LED is the link, so
you can see which boards are talking without a serial monitor:

| pattern | meaning |
|---|---|
| solid | transmitting a frame right now |
| one 120 ms flash | a frame arrived and passed CRC |
| blip every 2 s | link healthy, idle |
| fast 5 Hz blink | link lost — it worked, now it doesn't |
| slow 1 Hz blink | searching, never heard the other end |

## Dashboard

The power node serves a page with the budget (live slider), the node table and
link stats. It defaults to running as its own access point — `powerbus-XXXX`,
password `powerbus`, at `http://192.168.4.1` — because venue wifi is not worth
betting a demo on. `wifi <ssid> <pass>` then `save` switches to station mode.

Wi-Fi does not disturb the link: 20/20 loopback frames decoded with the AP up.
The page is served between poll cycles, so expect ~2 s of latency on updates.

## Wiring this firmware assumes

Per node, exactly the circuit from your schematic:

| Pin | Net |
|---|---|
| `D0` | junction of the 10k/10k divider; top 10k to BUS+, bottom 10k to GND |
| `D1` | IRFZ44N gate via 320R, 10k gate→GND pulldown. Drain → 47R → BUS+, source → GND |
| `D4` | second IRFZ44N gate (switched load / legacy LED) |
| `5V` | power node: USB in, and out through the ~1R to BUS+. Loads: BUS+ |
| `GND` | common |

The power node's own divider and its 47R **must sit on the downstream side of the
1R**, not on its USB-side 5V pin, or it can neither hear the loads nor hear itself.

## Do this before you trust any result

**Both boards plugged into USB will short out the 1R and kill the signal.** The
XIAO's 5V pin is tied straight to VBUS, so a C6 on your laptop's USB back-feeds
the bus and the series resistor has nothing across it. You get a dead-flat bus
and zero frames, with no obvious symptom.

For bring-up, where you want both serial monitors, decouple power from signalling:

- Power **each board from its own USB port** (same laptop → shared ground).
- Do **not** connect the C6's `5V` pin to BUS+.
- Build the bus as a standalone net: power-node `5V` → 1R → **BUS+**, and hook
  only the dividers (`D0`) and the 47R modulator drains to BUS+. GND common.

The bus then carries only the ~106 mA of modulation current, which is the only
current the 1R needs to see. Everything in this firmware works identically.
Once the link is solid, switch to the real topology (loads bus-powered, only the
power node on USB) and re-run `cal`/`mon` — the depth will change a little.

## Step 1 — is there a signal at all

1. Open both serial monitors at 115200. Each prints its resting baseline in ADC
   counts. At 5 V through a 10k/10k divider expect roughly **3200–3400**.
   Near 0 or near 4095 means the divider is wrong — fix that first.
2. On the **load** node type `mon`. It prints a per-250 ms min/max bar.
3. On the **power** node type `cal`. It keys the 47R at 10 Hz for 6 s.
4. The load node's `swing` should jump from single digits (noise) to **~40–70
   counts**. That is your MARK depth.
5. Swap roles and repeat, so you know both modulators and both receivers work.

If the swing is under ~20 counts the link will be unreliable. Measured depths on
this build, with a 47R shunt and a 10k/10k divider (the 0.2R row is plain jumper
wire and matched the bench reading of 14 counts, so the rest can be trusted):

| series R | shunt current | depth at the ADC | droop if loads are bus-powered (~250 mA) |
|---|---|---|---|
| 0.2 R (bare wire) | 106 mA | 14 counts | — |
| 1 R | 104 mA | 69 counts | 0.25 V, fine |
| 2.2 R | 102 mA | 148 counts | 0.55 V, marginal |
| 10 R | 88 mA | 579 counts | 2.5 V, boards dead |
| 47 R | 53 mA | 1650 counts | boards dead |

So the series resistor is what sets the link budget, and it trades directly
against how much droop the bus-powered nodes can stand. 1R-2.2R is the usable
window for the real topology. For signalling-only bring-up (nodes on their own
USB, nothing drawing through the bus) any value works, and a spare 47R gives an
enormous margin for free.

Two 47R in parallel as the shunt (23.5R) doubles the current, which buys ~135
counts at a 1R series — worth doing if 69 counts turns out to be marginal.

If `cal` produces *no* swing at all, the IRFZ44N isn't turning on from 3.3 V —
measure drain-to-source with `D1` high; it should be near 0 V, and anything above
~0.5 V means you need a logic-level part (IRLZ44N / AO3400) or a 2N2222 instead.

You don't have to set a threshold by hand: every boot runs `self` and adopts the
depth it measures. `PLC_DEPTH_DEFAULT` is only the fallback for when that
measurement comes back implausible.

## Step 2 — the link

Power node, type `ping`. You should get `pong from 1 in ~800 ms`.

Then it polls load 1 every 1.2 s on its own:

```
[   12.4s] load1  ON    2.5W  prio2  seq 10  rtt 462ms  grant=1   ok=10 miss=0 | base=3301 depth=52 crc=0 sync=0
```

`depth` is the measured modulation depth of the last good frame, `crc`/`sync` are
error counters — both should stay at 0. `miss` climbing means frames aren't
getting through; `sync` climbing means the preamble is being found but not
decoded (threshold or timing); `crc` climbing means bits are flipping (depth too
small, or try slowing the link down).

## Step 3 — prove it's live data

- `b 1` — budget drops to 1.0 W, below load 1's declared 2.5 W. Within one poll
  the load's LED goes out and its status flips to `OFF`.
- `b 10` — it comes back on.
- `l 0` / `l 1` — the legacy LED on the power node's `D4`.
- Pull the load module's bus wire: after 6 s it prints `LINK LOST` and sheds
  itself. That's the fail-safe, and it's the thing worth showing judges.

The power node's built-in LED is on while load 1 is answering, off when it isn't.

## Bring-up tools

| command | what it does |
|---|---|
| `self` | keys our own shunt, measures the depth on our own divider. Runs at boot and sets the detection threshold. Tests gate drive, MOSFET, shunt, series resistor and divider in one shot |
| `loop` | transmits a frame and decodes it on the same board. Proves the whole stack with one node |
| `trace` | same, but prints the two half-bit means and the recovered phase for every bit. This is what to reach for when frames won't decode |
| `dump` | raw ADC samples during a transmission — ground truth for whether a carrier exists |
| `bench` | `analogRead()` timing, which sets the floor for `sampleUs` |
| `mon` | live min/max bar; run on one node while the other runs `cal` |
| `rate a b` | change bit period / sample period live |

## How the link works

Manchester at 125 bps over on/off keying of the 47R shunt. MARK = MOSFET on =
bus pulled down. Every bit has a mid-bit transition, so decoding compares the two
halves of a bit rather than testing an absolute voltage — which matters here
because the baseline moves every time a load switches anywhere on the bus. The
decoder also tracks the bit clock off that transition, so the two boards don't
need matched oscillators.

Frame: 16 preamble bits · `0x7E` sync · len · payload · CRC-8. Payload is
`[src][dst][type][...]`.

Three things in the decoder are load-bearing, and each one was a bug first:

**Bits are decided by comparing the mean of the two half-bits**, not by
thresholding samples. It is a matched filter — averaging N samples cuts noise by
sqrt(N), and because the test is first-half-against-second-half it needs no
absolute threshold, which matters because the baseline moves whenever a load
switches.

**The mid-bit transition is found from the cumulative sum**, not from the first
sample to cross the midpoint. At this SNR individual samples cross the midpoint
constantly, so a first-crossing estimate reported sample ~1 on every bit and
dragged the clock backwards by the full clamp each bit. The all-1s preamble is
self-similar so it survived that, and the frame then died at the first sync bit.
The integral's extremum is the maximum-likelihood transition and is stable.

**Channel depth is estimated from the matched-filter output**, not from the
lowest sample in the frame. With sigma ~17 counts the minimum sample is just the
deepest noise excursion: it read 77 on a 14-count signal, which pushed the start
threshold below anything real and deafened the receiver completely.

Access is strict polling — only node 0 initiates, a load answers only its own
address after a 40 ms guard. No collisions by construction, and it extends to all
four boards unchanged. A 6-byte poll takes 352 ms, so a full transaction is about
0.8 s; `POLL_PERIOD_MS` is 1200.

### Rate, and why it is what it is

`rate <bitus> <sampus>` changes the link rate live, so you can sweep without
reflashing. `bench` reports how fast `analogRead()` is — 46.6 us on the S3, so
60 us is the practical sampling floor.

The ESP32 ADC is the noisy part of this system: 17.4 counts RMS per sample,
against a signal of 13-14 counts on a bus with no series resistor. The decoder
survives that only by averaging, and noise falls as sqrt(samples per half-bit),
so the bit rate *is* the link budget. Measured loopback reliability with no
series resistor:

| rate | samples/half-bit | frames decoded |
|---|---|---|
| 250 bps | 33 | 13 / 20 |
| 125 bps | 66 | 28 / 30 |
| 62 bps | 133 | 11 / 11 |

125 bps is the default. With a 1R series resistor the signal is ~5x larger and
250 bps or faster should be comfortable — re-measure before changing it.

### Two things this firmware does on purpose

`esp_task_wdt_deinit()` — the sampler and the modulator both busy-wait, which
starves the idle task and would otherwise trip the task watchdog. Wi-Fi is left
off for the same reason: its background work injects millisecond-scale jitter
into bit timing. When you add the dashboard, run it on the S3 (dual core) and
expect to lose the occasional frame to retries.

The 47R dissipates 0.44 W while keyed, but frames are short and the duty cycle
over a poll period is ~12%, so a 1/4 W part survives. `cal` is the exception — it
keys 50% for 6 s. Don't leave it running.
