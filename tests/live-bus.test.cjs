// Verifies the power-line bridge against a fake bus, so the integration can be
// checked without the hardware on the bench. Same vm harness as the other
// tests: the real app.js and live.js run, only the browser edges are stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function boot(busState, search = '?live=10.0.0.5') {
  const nodes = new Map();
  const fetched = [];
  class Node {
    constructor() {
      this.innerHTML = ''; this.textContent = ''; this.value = ''; this.hidden = false;
      this.disabled = false; this.dataset = {}; this.style = { cssText: '' }; this.attrs = {};
      this.listeners = {}; this.children = [];
      this.classList = { add() {}, remove() {}, toggle() {} };
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    setAttribute(n, v) { this.attrs[n] = String(v); }
    toggleAttribute(n, v) { if (v) this.attrs[n] = ''; else delete this.attrs[n]; }
    querySelector(sel) { return get(sel); }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() {} scrollIntoView() {} append() {} remove() {}
    appendChild(child) { this.children.push(child); return child; }
    emit(type, data = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault() {}, target: this, currentTarget: this, ...data }); }
  }
  function get(sel) { if (!nodes.has(sel)) nodes.set(sel, new Node()); return nodes.get(sel); }

  const byId = new Map();
  const body = new Node();
  const bySel = new Map();
  const timers = [];
  const store = new Map();

  const context = vm.createContext({
    console, Date, Math, Set, Map, JSON, String, Number, isFinite, Promise,
    URLSearchParams, innerWidth: 1400,
    document: {
      querySelector: get, querySelectorAll: () => [], addEventListener() {},
      createElement: () => new Node(), body,
      querySelector: sel => { if (!bySel.has(sel)) bySel.set(sel, new Node()); return bySel.get(sel); },
      getElementById: id => { if (!byId.has(id)) byId.set(id, new Node()); return byId.get(id); },
      readyState: 'complete'
    },
    window: { setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, addEventListener() {}, scrollTo() {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {} },
    location: { hash: '', search },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    fetch: url => {
      fetched.push(url);
      return Promise.resolve({ json: () => Promise.resolve(busState) });
    }
  });

  vm.runInContext(fs.readFileSync(path.join(__dirname, '../estimates.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../live.js'), 'utf8'), context);
  return { run: code => vm.runInContext(code, context), fetched, byId };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

const BUS = {
  budget_dW: 120, alloc_dW: 45, bps: 125, depth: 30, crc: 0, sync: 2, uptime: 90,
  local: { on: true, enabled: true, draw_dW: 20, prio: 0 },
  nodes: [
    { id: 1, present: true,  on: true,  draw_dW: 25, prio: 2, rtt: 1620, ok: 27, miss: 1 },
    { id: 2, present: true,  on: false, draw_dW: 25, prio: 3, rtt: 1655, ok: 12, miss: 0 },
    { id: 4, present: true,  on: true,  draw_dW: 40, prio: 0, rtt: 1700, ok: 5,  miss: 0 }
  ]
};

(async () => {
  const app = boot(BUS);
  await flush(); await flush();

  // --- the device list is replaced outright by what is on the bus ---
  assert.equal(app.run('ports.length'), 3, 'three bus nodes, three ports, no simulated leftovers');
  assert.equal(app.run('ports.every(p=>p.live)'), true, 'every remaining port is live');
  assert.equal(app.run('ports.some(p=>p.port==="Port B")'), false, 'simulated ports must be gone');

  const n1 = JSON.parse(app.run('JSON.stringify(ports.find(p=>p.port==="Node 1").devices[0])'));
  assert.equal(n1.name, 'Living room TV');
  assert.equal(n1.watts, 3, '25 dW is 2.5 W, rounded');
  assert.equal(n1.level, 'Important', 'priority 2 maps to Important');
  assert.equal(n1.liveShed, false);
  assert.match(n1.liveDetail, /over the power line/);

  // --- a shed node reads zero through the app's own accessor ---
  assert.equal(app.run('deviceDraw(ports.find(p=>p.port==="Node 2").devices[0])'), 0,
    'a node shed by the bus must draw 0 W in the UI');
  assert.match(app.run('deviceDetail(ports.find(p=>p.port==="Node 2").devices[0])'),
    /Shed by the power budget/);

  // --- an unnamed node still appears, named after its address ---
  assert.equal(app.run('ports.find(p=>p.port==="Node 4").devices[0].name'), 'Load 4');
  assert.equal(app.run('ports.find(p=>p.port==="Node 4").devices[0].level'), 'Critical',
    'priority 0 maps to Critical');

  // --- joins are logged as power-line events, which is the whole story ---
  const lineEvents = JSON.parse(app.run('JSON.stringify(liveActivity.filter(e=>e.channel==="line").map(e=>e.title))'));
  assert.ok(lineEvents.some(t => /connected/i.test(t)), 'connecting should be logged');
  assert.ok(lineEvents.some(t => /joined over the power line/.test(t)), 'joins should be logged');

  // --- the UI's level is pushed to the real bus as a budget ---
  assert.ok(app.fetched.some(u => /\/api\/state/.test(u)), 'should poll state');
  assert.ok(app.fetched.some(u => /\/api\/budget\?dw=120/.test(u)), 'level 2 should push 120 dW');

  // --- the scan panel shows what answered, not a scripted list ---
  const scanHtml = app.run('document.querySelector(".discovered-loads").innerHTML');
  assert.match(scanHtml, /Node 1/, 'scan results should list real nodes');
  assert.match(scanHtml, /answered over the power line/);
  assert.equal((scanHtml.match(/discovered-load/g) || []).length, 3, 'one card per present node');
  assert.match(scanHtml, /Protect/, 'a priority-0 node is protected');
  assert.doesNotMatch(scanHtml, /illustrative match/, 'no fabricated confidence scores');
  assert.ok(app.fetched.every(u => u.startsWith('http://10.0.0.5/')), 'host should come from ?live=');

  // --- no hardware means no interference ---
  const sim = boot(BUS, '?live=off');
  await flush(); await flush();
  assert.equal(sim.fetched.length, 0, 'live=off must not touch the network');
  assert.equal(sim.run('ports.some(p=>p.live)'), false, 'simulation model stays untouched');
  assert.equal(sim.run('deviceDraw(ports[1].devices[1])'), 12, 'TV keeps its simulated 12 W');

  console.log('PASS: bus replaces the device list; shed reads 0 W; unnamed node still appears; power-line events logged; level pushes budget; live=off is inert');
})().catch(err => { console.error(err); process.exit(1); });
