import { describe, expect, it } from "vitest";
import {
  calculateScope3CommuteEmissions,
  calculateSharedExpense,
  isPointInCorridor,
  loadMockCorridors,
  matchCorridor,
} from "../src/index.js";

const route = [
  { lat: 50, lng: 7 },
  { lat: 50, lng: 7.1 },
  { lat: 50, lng: 7.2 },
];

describe("isPointInCorridor", () => {
  it("checks distance to segment interiors, not only vertices", () => {
    expect(isPointInCorridor({ lat: 50.001, lng: 7.05 }, route, 150)).toBe(true);
    expect(isPointInCorridor({ lat: 50.01, lng: 7.05 }, route, 150)).toBe(false);
  });

  it("handles routes crossing the antimeridian", () => {
    const datelineRoute = [
      { lat: 10, lng: 179.9 },
      { lat: 10, lng: -179.9 },
    ];
    expect(isPointInCorridor({ lat: 10, lng: 180 }, datelineRoute, 100)).toBe(true);
  });

  it("rejects degenerate routes", () => {
    expect(() => isPointInCorridor({ lat: 50, lng: 7 }, [route[0]!, route[0]!], 100)).toThrow(
      "non-zero-length segment",
    );
  });
});

describe("matchCorridor", () => {
  it("matches points in route order and estimates detour time at 40 km/h", () => {
    const result = matchCorridor(route, { lat: 50, lng: 7.05 }, { lat: 50, lng: 7.15 });

    expect(result.matched).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.overlapRatio).toBeCloseTo(0.5, 1);
    expect(result.addedTravelTimeMinutes).toBeCloseTo(
      (result.estimatedDetourKm / 40) * 60,
    );
  });

  it("rejects a passenger travelling against the driver direction", () => {
    const result = matchCorridor(route, { lat: 50, lng: 7.15 }, { lat: 50, lng: 7.05 });

    expect(result.matched).toBe(false);
    expect(result.reason).toBe("wrong-direction");
  });

  it("lets callers override average speed", () => {
    const defaultResult = matchCorridor(route, { lat: 50.001, lng: 7.05 }, { lat: 50.001, lng: 7.15 });
    const fasterResult = matchCorridor(
      route,
      { lat: 50.001, lng: 7.05 },
      { lat: 50.001, lng: 7.15 },
      { averageSpeedKmh: 80 },
    );

    expect(fasterResult.addedTravelTimeMinutes).toBeCloseTo(defaultResult.addedTravelTimeMinutes / 2);
  });

  it("rejects circuity factors below straight-line distance", () => {
    expect(() =>
      matchCorridor(route, { lat: 50, lng: 7.05 }, { lat: 50, lng: 7.15 }, { circuityFactor: 0.9 }),
    ).toThrow("at least 1");
  });
});

describe("calculateSharedExpense", () => {
  it("splits fuel and toll costs evenly across total occupants, including the driver", () => {
    expect(calculateSharedExpense(10, 0.2, 4, 2)).toEqual({
      fuelCost: 2,
      tollsTotal: 2,
      totalCost: 4,
      seatCount: 4,
      costPerSeat: 1,
    });
  });

  it("requires at least one total occupant", () => {
    expect(() => calculateSharedExpense(10, 0.2, 0, 0)).toThrow("at least 1");
  });
});

describe("calculateScope3CommuteEmissions", () => {
  it("calculates carpool savings against solo petrol driving", () => {
    const solo = calculateScope3CommuteEmissions("car_petrol", 10);
    const carpool = calculateScope3CommuteEmissions("carpool", 10, { occupants: 2 });

    expect(carpool.emissionFactorKgCo2ePerKm).toBe(0.085);
    expect(carpool.tripKgCo2e).toBeCloseTo(0.85);
    expect(carpool.emissionsSavedVsSoloDriveKgCo2e).toBeCloseTo(0.85);
    expect(carpool.tripKgCo2e).toBe(solo.tripKgCo2e / 2);
  });

  it("returns zero trip emissions for bicycle and walking", () => {
    const result = calculateScope3CommuteEmissions("bicycle_walking", 12);

    expect(result.emissionFactorKgCo2ePerKm).toBe(0);
    expect(result.tripKgCo2e).toBe(0);
    expect(result.emissionsSavedVsSoloDriveKgCo2e).toBeCloseTo(2.04);
  });

  it("projects round-trip commute emissions across working days", () => {
    const result = calculateScope3CommuteEmissions("train_rail", 10, {
      returnTrip: true,
      workingDaysPerYear: 220,
    });

    expect(result.distanceKm).toBe(20);
    expect(result.tripKgCo2e).toBeCloseTo(0.7);
    expect(result.annualKgCo2e).toBeCloseTo(154);
  });
});

describe("loadMockCorridors", () => {
  it("returns zero-configuration corridors that the matcher can evaluate", () => {
    const corridors = loadMockCorridors();

    expect(corridors.length).toBeGreaterThan(1);
    expect(
      matchCorridor(
        corridors[0]!.driverRoute,
        corridors[0]!.passengerOrigin,
        corridors[0]!.passengerDestination,
      ).matched,
    ).toBe(true);
  });
});
