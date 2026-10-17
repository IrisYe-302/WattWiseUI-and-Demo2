const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../estimates.js');
const devices = [
  { name:'TV', watts:12, standby:true, level:'Flexible' },
  { name:'Console', watts:9, standby:true, level:'Flexible' },
  { name:'Fridge', watts:72, level:'Critical' }
];
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-8, `${value} != ${expected}`);
test('device annual potential uses unrounded energy and totals', () => {
  const result = E.standby(devices, .385);
  near(result.rows[0].annualKWh, 87.6);
  near(result.rows[1].annualKWh, 65.7);
  near(result.rows[0].annualSaving, 33.726);
  near(result.rows[1].annualSaving, 25.2945);
  near(result.annualSaving, 59.0205);
  assert.equal(E.dollars(result.rows[0].annualSaving), '$33.73');
  assert.equal(E.dollars(result.rows[1].annualSaving), '$25.29');
  assert.equal(E.dollars(result.annualSaving), '$59.02');
  assert.equal(result.eligibleWatts, 21);
  near(result.annualKWh, 153.3);
  near(E.standby(devices, .30).annualSaving, 45.99);
  const protectedTV = devices.map(d => d.name === 'TV' ? { ...d, level:'Important' } : d);
  assert.equal(E.standby(protectedTV, .385).eligibleWatts, 9);
  assert.equal(E.dollars(E.standby(protectedTV, .385).annualSaving), '$25.29');
  assert.deepEqual(E.standby([], .385).rows, []);
});
test('dishwasher peak comparison is separate; current off-peak schedule earns no increment', () => {
  const dish = E.dishwasher({ peakDiff:.24 });
  assert.equal(dish.shiftedKWh, 18);
  near(dish.monthlyPotential, 4.32);
  assert.equal(dish.incrementalMonthlySaving, 0);
  assert.equal(E.dishwasher({ peakDiff:0 }).monthlyPotential, 0);
  assert.equal(E.dishwasher({ peakDiff:.24, eligible:false }).monthlyPotential, 0);
  near(E.dishwasher({ peakDiff:.24, alreadyOffPeak:false }).incrementalMonthlySaving, 4.32);
});
test('city planning has conditional TOU and flat-rate cases from separate planning energy', () => {
  const city = E.cityScenario();
  assert.equal(city.households, 1439097);
  near(city.avoidedMonthlySaving, 10.50);
  near(city.shiftedMonthlySaving, 2.10);
  near(city.monthlySavingPerHome, 12.60);
  near(city.annualSavingPerHome, 151.20);
  near(city.flatAnnualSavingPerHome, 126);
  near(city.annualTotal, 21759146.64);
  near(city.flatAnnualTotal, 18132622.20);
  near(E.cityScenario(.01).annualTotal, 2175914.664);
  near(E.cityScenario(.05).annualTotal, 10879573.32);
  near(E.cityScenario(.01).flatAnnualTotal, 1813262.22);
  near(E.cityScenario(.05).flatAnnualTotal, 9066311.10);
  const before = JSON.stringify(city);
  E.standby(devices, .30); E.dishwasher({ peakDiff:0 });
  assert.equal(JSON.stringify(E.cityScenario()), before);
});
test('info page actually renders both scenarios and the adoption table from the shared model', () => {
  const nodes = new Map();
  const get = selector => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); };
  const context = vm.createContext({ WattwiseEstimates:E, document:{querySelector:get}, window:{} });
  const html = fs.readFileSync(path.join(__dirname, '../info.html'), 'utf8');
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(script, context);
  assert.equal(get('#cityAnnualTotal').textContent, '$21.8M / year');
  assert.equal(get('#cityFlatTotal').textContent, '$18.13M / year');
  assert.match(get('#cityFormula').textContent, /\$21,759,146\.64/);
  assert.match(get('#cityFlatFormula').textContent, /\$18,132,622\.20/);
  assert.equal((get('#cityAdoptionRows').innerHTML.match(/<tr>/g) || []).length, 3);
});
