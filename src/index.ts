export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export interface CorridorMatchOptions {
  /** Maximum distance from the driver route for pickup and dropoff (default: 1.5 km). */
  readonly maxBufferKm?: number;
  /** Road-network multiplier for pickup and dropoff access legs (default: 1.3). */
  readonly circuityFactor?: number;
  /** Minimum shared route distance for a match (default: 2 km). */
  readonly minSharedDistanceKm?: number;
  /** Assumed average speed for detour time (default: 40 km/h). */
  readonly averageSpeedKmh?: number;
}

export type CorridorMatchReason =
  | "outside-buffer"
  | "wrong-direction"
  | "shared-distance-too-short";

export interface CorridorMatchResult {
  readonly matched: boolean;
  readonly reason: CorridorMatchReason | null;
  readonly overlapRatio: number;
  readonly sharedDistanceKm: number;
  readonly driverTotalDistanceKm: number;
  readonly pickupDistanceKm: number;
  readonly dropoffDistanceKm: number;
  readonly estimatedDetourKm: number;
  readonly addedTravelTimeMinutes: number;
  readonly snappedPickup: LatLng;
  readonly snappedDropoff: LatLng;
}

export interface ExpenseBreakdown {
  readonly fuelCost: number;
  readonly tollsTotal: number;
  readonly totalCost: number;
  readonly seatCount: number;
  readonly costPerSeat: number;
}

export type CommuteTransportMode =
  | "car_petrol"
  | "car_diesel"
  | "car_hybrid"
  | "car_ev"
  | "carpool"
  | "motorcycle"
  | "bus"
  | "train_rail"
  | "subway_metro"
  | "bicycle_walking";

export interface Scope3EmissionsOptions {
  /** Total people counted for carpool allocation (default: 1). */
  readonly occupants?: number;
  /** Treat distanceKm as a one-way distance and double it (default: false). */
  readonly returnTrip?: boolean;
  /** If set, project the trip emissions over this many commuting days. */
  readonly workingDaysPerYear?: number;
}

export interface Scope3EmissionsResult {
  readonly mode: CommuteTransportMode;
  /** Evaluated commute distance, including return-trip doubling when requested. */
  readonly distanceKm: number;
  readonly emissionFactorKgCo2ePerKm: number;
  readonly tripKgCo2e: number;
  readonly annualKgCo2e?: number;
  readonly emissionsSavedVsSoloDriveKgCo2e?: number;
}

export interface MockCorridor {
  readonly name: string;
  readonly driverRoute: readonly LatLng[];
  readonly passengerOrigin: LatLng;
  readonly passengerDestination: LatLng;
}

interface Point2D {
  readonly x: number;
  readonly y: number;
}

interface Segment {
  readonly start: Point2D;
  readonly vx: number;
  readonly vy: number;
  readonly length: number;
  readonly lengthSquared: number;
  readonly distanceFromRouteStartKm: number;
}

interface ProjectedRoute {
  readonly originLat: number;
  readonly originLng: number;
  readonly kmPerLatitudeDegree: number;
  readonly kmPerLongitudeDegree: number;
  readonly points: readonly Point2D[];
  readonly segments: readonly Segment[];
  readonly totalDistanceKm: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

interface RouteProjection {
  readonly point: Point2D;
  readonly distanceKm: number;
  readonly distanceAlongRouteKm: number;
}

const DEFAULT_MAX_BUFFER_KM = 1.5;
const DEFAULT_CIRCUITY_FACTOR = 1.3;
const DEFAULT_MIN_SHARED_DISTANCE_KM = 2;
const DEFAULT_AVERAGE_SPEED_KMH = 40;
const SOLO_PETROL_FACTOR_KG_CO2E_PER_KM = 0.170;

const COMMUTE_EMISSION_FACTORS: Record<Exclude<CommuteTransportMode, "carpool">, number> = {
  car_petrol: 0.170,
  car_diesel: 0.165,
  car_hybrid: 0.110,
  car_ev: 0.045,
  motorcycle: 0.113,
  bus: 0.095,
  train_rail: 0.035,
  subway_metro: 0.028,
  bicycle_walking: 0,
};

/** Check distance to every route segment, with a bounding-box fast reject. */
export function isPointInCorridor(
  point: LatLng,
  polyline: readonly LatLng[],
  bufferMeters: number,
): boolean {
  assertLatLng(point, "point");
  assertNonNegativeFinite(bufferMeters, "bufferMeters");

  const route = projectRoute(polyline);
  const bufferKm = bufferMeters / 1000;
  const projectedPoint = projectPoint(point, route);

  if (!isWithinExpandedBounds(projectedPoint, route, bufferKm)) return false;
  return nearestRouteProjection(projectedPoint, route).distanceKm <= bufferKm;
}

/** Match a passenger's trip against a driver's route in the driver's direction. */
export function matchCorridor(
  driverRoute: readonly LatLng[],
  passengerOrigin: LatLng,
  passengerDestination: LatLng,
  options: CorridorMatchOptions = {},
): CorridorMatchResult {
  assertLatLng(passengerOrigin, "passengerOrigin");
  assertLatLng(passengerDestination, "passengerDestination");

  const maxBufferKm = options.maxBufferKm ?? DEFAULT_MAX_BUFFER_KM;
  const circuityFactor = options.circuityFactor ?? DEFAULT_CIRCUITY_FACTOR;
  const minSharedDistanceKm = options.minSharedDistanceKm ?? DEFAULT_MIN_SHARED_DISTANCE_KM;
  const averageSpeedKmh = options.averageSpeedKmh ?? DEFAULT_AVERAGE_SPEED_KMH;

  assertNonNegativeFinite(maxBufferKm, "maxBufferKm");
  assertNonNegativeFinite(minSharedDistanceKm, "minSharedDistanceKm");
  if (!Number.isFinite(circuityFactor) || circuityFactor < 1) {
    throw new RangeError("circuityFactor must be a finite number of at least 1");
  }
  assertPositiveFinite(averageSpeedKmh, "averageSpeedKmh");

  const route = projectRoute(driverRoute);
  const pickup = nearestRouteProjection(projectPoint(passengerOrigin, route), route);
  const dropoff = nearestRouteProjection(projectPoint(passengerDestination, route), route);
  const sharedDistanceKm = Math.max(0, dropoff.distanceAlongRouteKm - pickup.distanceAlongRouteKm);
  const overlapRatio = Math.min(1, sharedDistanceKm / route.totalDistanceKm);
  const estimatedDetourKm = circuityFactor * (pickup.distanceKm + dropoff.distanceKm);

  let reason: CorridorMatchReason | null = null;
  if (pickup.distanceKm > maxBufferKm || dropoff.distanceKm > maxBufferKm) {
    reason = "outside-buffer";
  } else if (dropoff.distanceAlongRouteKm <= pickup.distanceAlongRouteKm) {
    reason = "wrong-direction";
  } else if (sharedDistanceKm < minSharedDistanceKm) {
    reason = "shared-distance-too-short";
  }

  return {
    matched: reason === null,
    reason,
    overlapRatio,
    sharedDistanceKm,
    driverTotalDistanceKm: route.totalDistanceKm,
    pickupDistanceKm: pickup.distanceKm,
    dropoffDistanceKm: dropoff.distanceKm,
    estimatedDetourKm,
    addedTravelTimeMinutes: (estimatedDetourKm / averageSpeedKmh) * 60,
    snappedPickup: unprojectPoint(pickup.point, route),
    snappedDropoff: unprojectPoint(dropoff.point, route),
  };
}

/** Split fuel and toll costs evenly across all occupants, including the driver. */
export function calculateSharedExpense(
  distanceKm: number,
  fuelCostPerKm: number,
  passengers: number,
  tollsTotal: number,
): ExpenseBreakdown {
  assertNonNegativeFinite(distanceKm, "distanceKm");
  assertNonNegativeFinite(fuelCostPerKm, "fuelCostPerKm");
  assertNonNegativeFinite(tollsTotal, "tollsTotal");
  if (!Number.isInteger(passengers) || passengers < 1) {
    throw new RangeError("passengers must be an integer of at least 1 (total occupants, including driver)");
  }

  const fuelCost = distanceKm * fuelCostPerKm;
  const totalCost = fuelCost + tollsTotal;
  if (!Number.isFinite(fuelCost) || !Number.isFinite(totalCost)) {
    throw new RangeError("expense totals must be finite");
  }

  return {
    fuelCost,
    tollsTotal,
    totalCost,
    seatCount: passengers,
    costPerSeat: totalCost / passengers,
  };
}

/** Estimate commute emissions using the module's fixed distance-based factors. */
export function calculateScope3CommuteEmissions(
  mode: CommuteTransportMode,
  distanceKm: number,
  options: Scope3EmissionsOptions = {},
): Scope3EmissionsResult {
  assertNonNegativeFinite(distanceKm, "distanceKm");

  const occupants = options.occupants ?? 1;
  if (!Number.isInteger(occupants) || occupants < 1) {
    throw new RangeError("occupants must be an integer of at least 1");
  }

  if (options.workingDaysPerYear !== undefined) {
    assertNonNegativeFinite(options.workingDaysPerYear, "workingDaysPerYear");
  }

  const baseFactor = mode === "carpool"
    ? SOLO_PETROL_FACTOR_KG_CO2E_PER_KM
    : COMMUTE_EMISSION_FACTORS[mode];
  if (baseFactor === undefined) {
    throw new RangeError("mode must be a supported commute transport mode");
  }

  const emissionFactorKgCo2ePerKm = mode === "carpool" ? baseFactor / occupants : baseFactor;
  const evaluatedDistanceKm = distanceKm * (options.returnTrip ? 2 : 1);
  const tripKgCo2e = evaluatedDistanceKm * emissionFactorKgCo2ePerKm;
  if (!Number.isFinite(evaluatedDistanceKm) || !Number.isFinite(tripKgCo2e)) {
    throw new RangeError("commute emissions totals must be finite");
  }

  const result: Scope3EmissionsResult = {
    mode,
    distanceKm: evaluatedDistanceKm,
    emissionFactorKgCo2ePerKm,
    tripKgCo2e,
    emissionsSavedVsSoloDriveKgCo2e:
      (SOLO_PETROL_FACTOR_KG_CO2E_PER_KM - emissionFactorKgCo2ePerKm) * evaluatedDistanceKm,
  };

  if (options.workingDaysPerYear !== undefined) {
    const annualKgCo2e = tripKgCo2e * options.workingDaysPerYear;
    if (!Number.isFinite(annualKgCo2e)) {
      throw new RangeError("annual emissions total must be finite");
    }
    return { ...result, annualKgCo2e };
  }

  return result;
}

/** Return synthetic Bonn–Köln route samples for demos and tests. */
export function loadMockCorridors(): MockCorridor[] {
  const bonnToCologne: LatLng[] = [
    { lat: 50.7374, lng: 7.0982 },
    { lat: 50.758, lng: 7.143 },
    { lat: 50.785, lng: 7.179 },
    { lat: 50.812, lng: 7.196 },
    { lat: 50.842, lng: 7.159 },
    { lat: 50.875, lng: 7.115 },
    { lat: 50.908, lng: 7.067 },
    { lat: 50.9375, lng: 6.9603 },
  ];

  return [
    {
      name: "Bonn–Köln (synthetic)",
      driverRoute: bonnToCologne,
      passengerOrigin: { lat: 50.807, lng: 7.202 },
      passengerDestination: { lat: 50.908, lng: 7.061 },
    },
    {
      name: "Köln–Bonn (synthetic)",
      driverRoute: [...bonnToCologne].reverse(),
      passengerOrigin: { lat: 50.908, lng: 7.061 },
      passengerDestination: { lat: 50.807, lng: 7.202 },
    },
  ];
}

function projectRoute(polyline: readonly LatLng[]): ProjectedRoute {
  if (!Array.isArray(polyline) || polyline.length < 2) {
    throw new RangeError("polyline must contain at least two coordinates");
  }

  for (const [index, point] of polyline.entries()) {
    assertLatLng(point, `polyline[${index}]`);
  }

  const firstLongitude = polyline[0]!.lng;
  let minLongitude = Number.POSITIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;
  let minLatitude = Number.POSITIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;
  for (const point of polyline) {
    const longitude = firstLongitude + longitudeDelta(point.lng, firstLongitude);
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    minLatitude = Math.min(minLatitude, point.lat);
    maxLatitude = Math.max(maxLatitude, point.lat);
  }
  if (maxLongitude - minLongitude > 180) {
    throw new RangeError("polyline must describe a localized corridor spanning no more than 180 degrees");
  }

  const originLat = (minLatitude + maxLatitude) / 2;
  const originLng = (minLongitude + maxLongitude) / 2;
  const latitudeRadians = toRadians(originLat);
  const kmPerLatitudeDegree =
    111.13209 - 0.56605 * Math.cos(2 * latitudeRadians) + 0.0012 * Math.cos(4 * latitudeRadians);
  const kmPerLongitudeDegree =
    111.41513 * Math.cos(latitudeRadians) -
    0.09455 * Math.cos(3 * latitudeRadians) +
    0.00012 * Math.cos(5 * latitudeRadians);

  const points = polyline.map((point) => ({
    x: longitudeDelta(point.lng, originLng) * kmPerLongitudeDegree,
    y: (point.lat - originLat) * kmPerLatitudeDegree,
  }));
  const segments: Segment[] = [];
  let totalDistanceKm = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const vx = end.x - start.x;
    const vy = end.y - start.y;
    const lengthSquared = vx * vx + vy * vy;
    if (lengthSquared === 0) continue;

    const length = Math.sqrt(lengthSquared);
    segments.push({
      start,
      vx,
      vy,
      length,
      lengthSquared,
      distanceFromRouteStartKm: totalDistanceKm,
    });
    totalDistanceKm += length;
  }

  if (segments.length === 0) {
    throw new RangeError("polyline must contain at least one non-zero-length segment");
  }

  return {
    originLat,
    originLng,
    kmPerLatitudeDegree,
    kmPerLongitudeDegree,
    points,
    segments,
    totalDistanceKm,
    minX,
    maxX,
    minY,
    maxY,
  };
}

function nearestRouteProjection(point: Point2D, route: ProjectedRoute): RouteProjection {
  let nearestPoint: Point2D | undefined;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  let nearestDistanceAlongRouteKm = 0;

  for (const segment of route.segments) {
    const wx = point.x - segment.start.x;
    const wy = point.y - segment.start.y;
    const t = Math.max(0, Math.min(1, (wx * segment.vx + wy * segment.vy) / segment.lengthSquared));
    const snapped = {
      x: segment.start.x + t * segment.vx,
      y: segment.start.y + t * segment.vy,
    };
    const dx = point.x - snapped.x;
    const dy = point.y - snapped.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < nearestDistanceSquared) {
      nearestPoint = snapped;
      nearestDistanceSquared = distanceSquared;
      nearestDistanceAlongRouteKm = segment.distanceFromRouteStartKm + t * segment.length;
    }
  }

  return {
    point: nearestPoint!,
    distanceKm: Math.sqrt(nearestDistanceSquared),
    distanceAlongRouteKm: nearestDistanceAlongRouteKm,
  };
}

function projectPoint(point: LatLng, route: ProjectedRoute): Point2D {
  return {
    x: longitudeDelta(point.lng, route.originLng) * route.kmPerLongitudeDegree,
    y: (point.lat - route.originLat) * route.kmPerLatitudeDegree,
  };
}

function unprojectPoint(point: Point2D, route: ProjectedRoute): LatLng {
  return {
    lat: route.originLat + point.y / route.kmPerLatitudeDegree,
    lng: normalizeLongitude(route.originLng + point.x / route.kmPerLongitudeDegree),
  };
}

function isWithinExpandedBounds(point: Point2D, route: ProjectedRoute, bufferKm: number): boolean {
  return (
    point.x >= route.minX - bufferKm &&
    point.x <= route.maxX + bufferKm &&
    point.y >= route.minY - bufferKm &&
    point.y <= route.maxY + bufferKm
  );
}

function assertLatLng(point: LatLng, name: string): void {
  if (
    !point ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    point.lat < -90 ||
    point.lat > 90 ||
    point.lng < -180 ||
    point.lng > 180
  ) {
    throw new RangeError(`${name} must have a finite latitude in [-90, 90] and longitude in [-180, 180]`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite positive number`);
  }
}

function longitudeDelta(longitude: number, referenceLongitude: number): number {
  return ((longitude - referenceLongitude + 540) % 360) - 180;
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
