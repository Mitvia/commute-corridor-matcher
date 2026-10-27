#!/usr/bin/env node

import {
  calculateScope3CommuteEmissions,
  calculateSharedExpense,
  loadMockCorridors,
  matchCorridor,
} from "./index.js";

const corridor = loadMockCorridors()[0]!;
const match = matchCorridor(
  corridor.driverRoute,
  corridor.passengerOrigin,
  corridor.passengerDestination,
);
const expenses = calculateSharedExpense(match.sharedDistanceKm, 0.2, 2, 0);
const scope3CommuteEmissions = calculateScope3CommuteEmissions(
  "carpool",
  match.sharedDistanceKm,
  { occupants: 2, returnTrip: true, workingDaysPerYear: 220 },
);

console.log(JSON.stringify({ corridor: corridor.name, match, expenses, scope3CommuteEmissions }, null, 2));
