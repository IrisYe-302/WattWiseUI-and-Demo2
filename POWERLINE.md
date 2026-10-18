# Live power-line bus

The Wattwise UI can read the real hardware instead of the simulation. The bus is
four XIAO boards sharing two wires that carry power *and* data — one power node,
the rest load adapters that announce themselves, report their draw and shed when
the budget runs short. No data line, no pairing.

Firmware lives in `../firmware/plc_node`.

## Running it

Power node up (it serves an access point by default):

```
wifi:      powerbus-XXXX  /  powerbus
API:       http://192.168.4.1/api/state
```

Join that network, then open the UI with the host as a query parameter:

```
index.html?live=192.168.4.1
```

The setting is remembered. `?live=off` returns to pure simulation and clears it.

A pill in the bottom right shows the state of the link: node count and bit rate
when connected, `offline` when not.

## What it changes

**Nothing, unless the hardware answers.** If the bus is unreachable the page
behaves exactly as before — same numbers, same script, same timings. That is
deliberate: a breadboard should not be able to break the pitch. The existing
test suites still pass unmodified.

When it does connect:

- **The device list is replaced outright.** Simulated ports disappear; what you
  see is what is on the bus. Half-real is worse than either, because nobody can
  tell which tiles mean anything.
- `NAMES` at the top of `live.js` is cosmetic — it gives a node id a label and
  icon that suit the story. A node with no entry still appears, named after its
  address, so a board plugged in mid-demo needs no configuration.
- Port headers read `LIVE` instead of `SIMULATED`.
- If the bus goes away, the simulated list is restored rather than left stale.
- Joining, leaving and shedding are written to the Activity log with
  `channel: "line"`, so they appear under the **Network** filter next to the
  existing Oct 15 entry. Those events are now real rather than seeded.
- The UI's level is pushed back to the bus as a power budget, so stepping the
  simulation down to critical-only physically sheds loads on the bench.

That last point is the one worth rehearsing. Step 5 of `DEMO.md` already steps
from Level 3 to Level 4 during the wildfire shutoff. With the bus connected,
the LED on a real adapter goes dark at the same moment the tile on screen does,
because the shed command travelled over the power conductors.

## Mapping nodes to tiles

```js
var MAP = {
  1: { port: "Port B", device: "Living room TV" },
  2: { port: "Port C", device: "Bedside lamp" },
  3: { port: "Port A", device: "Dishwasher" }
};
```

Node priority becomes the UI's level: `0` is Critical, `1–2` Important, `3+`
Flexible. Set a node's priority and declared draw over its serial console with
`prio N` / `draw W` / `save`.

Budget per UI level, in deciwatts:

```js
var LEVEL_BUDGET_dW = [200, 150, 120, 80, 20];
```

## What was touched

| file | change |
|---|---|
| `live.js` | new — the whole bridge |
| `tests/live-bus.test.cjs` | new — runs the bridge against a fake bus |
| `app.js` | 3 lines: a `liveShed` check in `deviceDraw`, a `liveDetail` check in `deviceDetail`, and `LIVE`/`SIMULATED` in the port header |
| `index.html` | 1 line: the `live.js` script tag |

Checks: `node --check live.js`, `node tests/live-bus.test.cjs`, plus the two
existing suites. The bridge test stubs the browser edges and a fake bus, so it
verifies the integration without hardware present.

## Honesty note

When the bus is connected the page says so directly under the title: the
devices are real hardware, and the battery, history and pricing are simulated.

Real: node presence, join and leave, on/shed state, priority, round-trip time,
bit rate, modulation depth, CRC and resync counters, and the budget allocation.

Simulated: the battery and its state of charge, the four weeks of history and
savings, the tariffs, and the outage runtime estimates. There is no battery, no
meter and no historian on the bench, so these have no hardware source and are
left labelled rather than dressed up.

Declared, not measured: each node's wattage is the figure it reports over the
bus (`draw 2.5`), not a current measurement. There is no shunt sensing on the
adapters.
