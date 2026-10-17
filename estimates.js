// Reusable estimates only: these functions never change device, history or control state.
(function (root, factory) {
  const estimates = factory();
  if (typeof module === "object" && module.exports) module.exports = estimates;
  else root.WattwiseEstimates = estimates;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const ASSUMPTIONS = Object.freeze({ standbyHoursPerDay: 20, daysPerYear: 365, dishwasherRunsPerMonth: 15, dishwasherKWhPerRun: 1.2 });
  // Supplied business-planning assumptions, independent of app devices and tariff.
  const CITY = Object.freeze({ households: 1439097, avoidedKWhPerMonth: 35, pricePerKWh: 0.30, shiftedKWhPerMonth: 30, peakDiff: 0.07 });
  function standby(devices, pricePerKWh, hoursPerDay = ASSUMPTIONS.standbyHoursPerDay) {
    const rows = devices.filter(device => device.standby).map(device => {
      const eligible = device.level === "Flexible";
      const annualKWh = eligible ? device.watts / 1000 * hoursPerDay * ASSUMPTIONS.daysPerYear : 0;
      return { name: device.name, watts: device.watts, eligible, annualKWh, annualSaving: annualKWh * pricePerKWh };
    });
    return {
      rows,
      eligibleWatts: rows.reduce((sum, row) => sum + (row.eligible ? row.watts : 0), 0),
      annualKWh: rows.reduce((sum, row) => sum + row.annualKWh, 0),
      annualSaving: rows.reduce((sum, row) => sum + row.annualSaving, 0)
    };
  }
  function dishwasher({ peakDiff, eligible = true, alreadyOffPeak = true }) {
    const shiftedKWh = ASSUMPTIONS.dishwasherRunsPerMonth * ASSUMPTIONS.dishwasherKWhPerRun;
    const monthlyPotential = eligible ? shiftedKWh * Math.max(0, peakDiff) : 0;
    return { shiftedKWh, monthlyPotential, incrementalMonthlySaving: alreadyOffPeak ? 0 : monthlyPotential };
  }
  function cityScenario(adoption = 0.10) {
    const avoidedMonthlySaving = CITY.avoidedKWhPerMonth * CITY.pricePerKWh;
    const shiftedMonthlySaving = CITY.shiftedKWhPerMonth * CITY.peakDiff;
    const monthlySavingPerHome = avoidedMonthlySaving + shiftedMonthlySaving;
    const annualSavingPerHome = monthlySavingPerHome * 12;
    const flatAnnualSavingPerHome = avoidedMonthlySaving * 12;
    return { ...CITY, adoption, avoidedMonthlySaving, shiftedMonthlySaving, monthlySavingPerHome,
      annualSavingPerHome, flatAnnualSavingPerHome,
      annualTotal: CITY.households * adoption * annualSavingPerHome,
      flatAnnualTotal: CITY.households * adoption * flatAnnualSavingPerHome };
  }
  const dollars = value => `$${value.toFixed(2)}`;
  return Object.freeze({ ASSUMPTIONS, CITY, standby, dishwasher, cityScenario, dollars });
});
