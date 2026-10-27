# commute-corridor-matcher

Zero-runtime-dependency TypeScript helpers for matching an origin and destination to a driver's commuter route and estimating a simple shared expense split. Geometry runs in memory; the package makes no network requests and stores no data.

## Install

```sh
npm install commute-corridor-matcher
```

## Quick start

```ts
import {
  calculateScope3CommuteEmissions,
  loadMockCorridors,
  matchCorridor,
} from "commute-corridor-matcher";

const corridor = loadMockCorridors()[0]!;
const result = matchCorridor(
  corridor.driverRoute,
  corridor.passengerOrigin,
  corridor.passengerDestination,
);

console.log(result.matched, result.overlapRatio, result.estimatedDetourKm);

const emissions = calculateScope3CommuteEmissions("carpool", result.sharedDistanceKm, {
  occupants: 2,
  returnTrip: true,
  workingDaysPerYear: 220,
});

console.log(emissions.tripKgCo2e, emissions.annualKgCo2e);
```

## API

### `isPointInCorridor(point, polyline, bufferMeters)`

Returns whether a coordinate lies within the buffer of any route segment. Segment projection uses a clamped vector dot product, so points beside the middle of a long segment are handled correctly.

### `matchCorridor(driverRoute, passengerOrigin, passengerDestination, options?)`

Projects the passenger's endpoints onto the driver route and checks that both fall within the route buffer, travel in the driver's direction, and share at least the configured distance.

The route is projected to a WGS84 curvature-compensated local tangent plane. Route distance uses the projected segment lengths. Estimated detour is `circuityFactor × (pickup distance + dropoff distance)`; added minutes divide that estimate by `averageSpeedKmh` (40 km/h by default).

| Option | Default | Meaning |
| --- | ---: | --- |
| `maxBufferKm` | `1.5` | Maximum pickup/dropoff distance from the route |
| `circuityFactor` | `1.3` | Multiplier for road access and egress distance |
| `minSharedDistanceKm` | `2` | Minimum distance shared along the route |
| `averageSpeedKmh` | `40` | Speed used to estimate added travel time |

`overlapRatio` is the shared route distance divided by the driver's total route distance. `reason` is `outside-buffer`, `wrong-direction`, or `shared-distance-too-short` for rejected matches; it is `null` for a match.

### `calculateSharedExpense(distanceKm, fuelCostPerKm, passengers, tollsTotal)`

Returns the fuel cost, tolls, total cost, seat count, and per-seat share. `passengers` is the total occupant count and includes the driver. The formula is `(distanceKm × fuelCostPerKm + tollsTotal) / passengers`.

### `calculateScope3CommuteEmissions(mode, distanceKm, options?)`

Estimates Scope 3 Category 7 employee commuting emissions with a distance-based calculation. The helper uses fixed approximate factors in kg CO₂e per km:

| Mode | Factor |
| --- | ---: |
| Petrol car | 0.170 |
| Diesel car | 0.165 |
| Hybrid car | 0.110 |
| Electric car | 0.045 |
| Carpool | 0.170 ÷ `occupants` |
| Motorcycle | 0.113 |
| Bus | 0.095 |
| Train / rail | 0.035 |
| Subway / metro | 0.028 |
| Bicycle / walking | 0 |

`returnTrip: true` doubles `distanceKm` before calculating trip emissions, and the returned `distanceKm` reflects that adjusted distance. If `workingDaysPerYear` is set, `annualKgCo2e` is `tripKgCo2e × workingDaysPerYear`. `emissionsSavedVsSoloDriveKgCo2e` compares every mode with solo petrol driving at 0.170 kg CO₂e/km.

These are fixed starter estimates, not year- or location-specific reporting factors. The [GHG Protocol Category 7 guidance](https://ghgprotocol.org/sites/default/files/standards/Scope3_Calculation_Guidance_0.pdf) describes the distance-based method for employee commuting. For formal inventories, use the applicable reporting year's factors, such as the [UK government conversion factors](https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting), which are updated annually.

### `loadMockCorridors()`

Returns synthetic Bonn–Köln and Köln–Bonn corridors with passenger endpoints. They need no API key or network access.

## CLI

```sh
npm run demo
```

The CLI builds the package, runs a mock match and Scope 3.7 carpool calculation, and prints the results as JSON.

## Development

```sh
npm install
npm test
npm run build
```

The package builds ESM and CommonJS entry points. TypeScript and Vitest are development-only dependencies; the published runtime has no dependencies.

## License and provenance

MIT. This package contains stateless geometry and arithmetic only; it does not handle payments or payouts.

Maintained by the engineering team at [Mitvia](https://mitvia.com) — Verified Commute Coordination Platform.
