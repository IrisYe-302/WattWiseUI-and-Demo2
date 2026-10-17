// Node-only regression harness executes the complete app and its real event handlers.
// The root integrator additionally verifies layout and interactions in a real browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function boot() {
  const nodes = new Map();
  class Node {
    constructor() { this.innerHTML = ''; this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false; this.dataset = {}; this.style = {}; this.attrs = {}; this.listeners = {}; this.classList = { add(){}, remove(){}, toggle(){} }; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    toggleAttribute(name, value) { if (value) this.attrs[name] = ''; else delete this.attrs[name]; }
    querySelector(selector) { return get(selector); }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; this.emit('close'); }
    focus(){} scrollIntoView(){} append(){} remove(){}
    emit(type, data = {}) { for (const fn of this.listeners[type] || []) fn({ preventDefault(){}, target:this, currentTarget:this, ...data }); }
  }
  function get(selector) { if (!nodes.has(selector)) nodes.set(selector, new Node()); return nodes.get(selector); }
  const timers = [];
  const context = vm.createContext({ console, Date, Math, Set, JSON, String, Number, isFinite, innerWidth:1400,
    document: { querySelector:get, querySelectorAll:()=>[], addEventListener(){}, createElement:()=>new Node() },
    window: { setTimeout:fn=>{ timers.push(fn); return timers.length; }, clearTimeout(){}, addEventListener(){}, scrollTo(){} },
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},sessionStorage:{getItem:()=>null,setItem(){}}, location:{hash:''},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),context);
  return { get, run:code=>vm.runInContext(code,context), timers };
}
const app = boot();
const {get,run}=app;
assert.equal(get('#livePillText').textContent,'Simulation');
assert.match(get('#usageDescription').textContent,/900 watts simulated use now/);
assert.match(get('#usageLine').attrs.d,/L560 82\.000$/);
const past = run('JSON.stringify(CHART_HISTORY)');
run('applySuggestion(0)');
assert.equal(get('#suggestionDialog').open,true);
assert.equal(run('suggestions[0].applied'),false,'opening review cannot apply');
get('#cancelSuggestionReview').emit('click');
assert.equal(run('suggestions[0].applied'),false,'cancel must have no mutation');
run('applySuggestion(0)');
get('#suggestionReviewForm').emit('submit');
assert.equal(run('suggestions[0].applied'),true);
assert.equal(run('homeKW()'),0.879);
assert.match(get('#applySuggestion').textContent,/Restore now/);
run('restoreSuggestion(0)');
assert.equal(run('homeKW()'),0.9);
// Current priority controls both displayed estimate and actual eligibility.
run('ports[1].devices[1].level="Important"; applySuggestion(0)');
assert.match(get('#suggestionReviewDevices').innerHTML,/Protected · unchanged/);
assert.match(get('#suggestionReviewFacts').innerHTML,/9 W · 1 devices/);
get('#suggestionReviewForm').emit('submit');
assert.equal(run('deviceDraw(ports[1].devices[1])'),12);
assert.equal(run('deviceDraw(ports[1].devices[2])'),0);
assert.equal(run('suggestions[0].watts'),'9 W');
run('restoreSuggestion(0); ports[1].devices[2].level="Critical"; applySuggestion(0)');
assert.equal(get('#confirmSuggestion').disabled,true);
get('#cancelSuggestionReview').emit('click');
// Room grouping keeps editing bound to original port and device indices.
run('deviceView="rooms"; renderPorts()');
assert.match(get('#portList').innerHTML,/<h3>Living room<\/h3>/);
assert.match(get('#portList').innerHTML,/data-edit-port="1" data-edit-device="2"/);
// Schedule cancellation restores the exact previous state, not a fabricated run.
const schedule = run('ports[0].devices[1].detail');
run('applySuggestion(1)');get('#suggestionReviewForm').emit('submit');
assert.equal(run('suggestions[1].applied'),true);
run('restoreSuggestion(1)');assert.equal(run('ports[0].devices[1].detail'),schedule);
// Outage reasons and suggestion reasons remain independent; restore cannot defeat protection.
run('ports[1].devices[1].level="Flexible"; ports[1].devices[2].level="Flexible"; applySuggestion(0)');
get('#suggestionReviewForm').emit('submit');
run('setMode("outage"); state.level=4; render(); restoreSuggestion(0)');
assert.equal(run('suggestions[0].applied'),false);
assert.equal(run('deviceDraw(ports[1].devices[1])'),0);
assert.equal(run('homeKW()'),0.164);
assert.match(get('#usageDescription').textContent,/164 watts simulated use now/);
assert.match(get('#usageLine').attrs.d,/L560 140\.880$/);
assert.equal(get('#billCard').hidden,true);
assert.equal(get('#outageSummary').hidden,false);
assert.match(get('#outageRuntime').textContent,/60h 45m/);
assert.match(get('#outageFacts').innerHTML,/164 W · Level 4/);
assert.equal(run('JSON.stringify(CHART_HISTORY)'),past,'switching modes must not rewrite demo history');
run('ports[0].devices[1].level="Important"; render()');
assert.doesNotMatch(get('#outagePaused').textContent,/Dishwasher/,'protected dishwasher must not be listed paused');
run('setMode("saver")');
assert.equal(run('deviceDraw(ports[1].devices[1])'),12);
assert.equal(get('#billCard').hidden,false);
// Short outage stays at Level 3; no more cuts than its scenario needs.
const short=boot();short.run('state.outageHours=4;setMode("outage")');
short.timers[0]();
assert.equal(short.run('state.level'),3);
assert.match(short.get('#outageCoverage').textContent,/cover the 4 h scenario/);
console.log('PASS: full app boots; review/cancel/apply/restore; protected eligibility; Room edit binding; schedule recovery; outage reasons; chart endpoint/history; short outage');
