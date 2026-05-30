export const KM_PER_MILE = 1.60934;
export const LITER_PER_GAL = 3.78541;
export const CURRENCY_SYM = { USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

export function interpolateGph(curve, speed) {
  if (!curve?.length) return 0;
  const s = [...curve].sort((a, b) => a.speed - b.speed);
  if (speed <= s[0].speed) return s[0].gph;
  if (speed >= s[s.length - 1].speed) return s[s.length - 1].gph;
  for (let i = 0; i < s.length - 1; i++) {
    if (speed >= s[i].speed && speed <= s[i + 1].speed) {
      const t = (speed - s[i].speed) / (s[i + 1].speed - s[i].speed);
      return s[i].gph + t * (s[i + 1].gph - s[i].gph);
    }
  }
  return s[s.length - 1].gph;
}

export const boatGphAtTarget = (v, speed) =>
  interpolateGph(v.fuel?.curve, speed ?? v.fuel?.targetSpeed ?? 5.5);

export function legConsumption(vehicle, leg) {
  if (vehicle.kind === "boat") {
    const spd = parseFloat(leg.cruisingSpeed) || vehicle.fuel?.targetSpeed || 5.5;
    return leg.durationH * boatGphAtTarget(vehicle, spd);
  }
  const miles = leg.unit === "km" ? leg.distance / KM_PER_MILE : leg.distance;
  const gallons = miles / vehicle.fuel.mpgCombined;
  return vehicle.fuel.unit === "L" ? gallons * LITER_PER_GAL : gallons;
}

// pinnedRefuels = [{ beforeLegIdx, amount, source, movedFromIdx?, station? }]
export function simulateFuelPlan(vehicle, legs, startingFuel, pinnedRefuels = []) {
  if (!vehicle?.fuel?.tankSize || !legs?.length) {
    return { rows: [], finalLevel: startingFuel, reserve: 0, tank: vehicle?.fuel?.tankSize ?? 0,
      totals: { consumed: 0, refuels: 0, refuelAmount: 0, cost: 0, refuelCost: 0 } };
  }
  const tank = vehicle.fuel.tankSize;
  const reserve = tank * ((vehicle.fuel.reservePct ?? 15) / 100);
  let level = startingFuel;
  const rows = [];
  let totalConsumed = 0, totalRefuelAmount = 0, refuelCount = 0;
  const pinnedByIdx = new Map((pinnedRefuels ?? []).map(p => [p.beforeLegIdx, p]));

  legs.forEach((leg, i) => {
    const pin = pinnedByIdx.get(i);
    if (pin) {
      const levelBefore = level;
      level = Math.min(tank, level + pin.amount);
      rows.push({ kind: "refuel", beforeLegIdx: i, pinned: true, source: pin.source,
        movedFromIdx: pin.movedFromIdx ?? null, station: pin.station ?? null,
        levelBefore, amountAdded: pin.amount, levelAfter: level,
        topOffPct: Math.round(level / tank * 100) });
      totalRefuelAmount += pin.amount;
      refuelCount++;
    }

    const consume = legConsumption(vehicle, leg);
    if (!pin && level - consume < reserve) {
      const amount = Math.max(1, Math.round(tank - level));
      const levelBefore = level;
      level = Math.min(tank, level + amount);
      rows.push({ kind: "refuel", beforeLegIdx: i, pinned: false, source: "auto",
        movedFromIdx: null, station: null,
        levelBefore, amountAdded: amount, levelAfter: level,
        topOffPct: Math.round(level / tank * 100) });
      totalRefuelAmount += amount;
      refuelCount++;
    }

    const before = level;
    level -= consume;
    rows.push({ kind: "leg", legIdx: i, leg, consume, levelBefore: before, levelAfter: level,
      pctAfter: Math.max(0, Math.round(level / tank * 100)),
      belowReserve: level < reserve, empty: level < 0 });
    totalConsumed += consume;
  });

  return {
    rows, finalLevel: level, reserve, tank,
    totals: { consumed: totalConsumed, refuels: refuelCount, refuelAmount: totalRefuelAmount,
      cost: totalConsumed * (vehicle.cost?.perUnit ?? 0),
      refuelCost: totalRefuelAmount * (vehicle.cost?.perUnit ?? 0) },
  };
}

export function simulateAutoBaseline(vehicle, legs, startingFuel) {
  return simulateFuelPlan(vehicle, legs, startingFuel, []);
}

export function parseDurationHours(str) {
  if (!str) return 0;
  const h = str.match(/(\d+)\s*h/i);
  const m = str.match(/(\d+)\s*m/i);
  return (h ? +h[1] : 0) + (m ? +m[1] / 60 : 0);
}

export function subtractMinutes(hhmm, mins) {
  if (!hhmm) return "09:00";
  const [h, m] = hhmm.split(":").map(Number);
  let total = Math.max(6 * 60, h * 60 + m - mins);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function defaultStartingFuel(vehicle) {
  if (!vehicle?.fuel) return 0;
  if (vehicle.rentalOf || vehicle.isRental) return vehicle.fuel.tankSize;
  return Math.round(vehicle.fuel.tankSize * ((vehicle.fuel.currentPct ?? 100) / 100) * 10) / 10;
}

// Build sorted leg array for a single vehicle from savedRoutes / savedDirections.
export function buildLegsForVehicle(vehicleId, kind, savedRoutes, savedDirections) {
  const legs = [];
  if (kind === "boat") {
    Object.entries(savedRoutes ?? {}).forEach(([dayStr, arr]) => {
      const dayNum = parseInt(dayStr, 10);
      (arr ?? []).forEach(r => {
        if (r.vehicleId !== vehicleId || !r.hrs || r.hrs <= 0) return;
        const h = Math.floor(r.hrs), m = Math.round((r.hrs - h) * 60);
        legs.push({
          day: `Day ${dayNum}`, from: r.startName || "", to: r.endName || "",
          distance: r.nm ?? 0, unit: "nm",
          duration: h ? `${h}h ${m}m` : `${m}m`,
          durationH: r.hrs,
          cruisingSpeed: r.cruisingSpeed || null,
          _dayNum: dayNum, _time: r.time || "", _itemId: r.id,
        });
      });
    });
  } else {
    Object.entries(savedDirections ?? {}).forEach(([dayStr, arr]) => {
      const dayNum = parseInt(dayStr, 10);
      (arr ?? []).forEach(d => {
        if (d.vehicleId !== vehicleId || d.travelMode !== "DRIVING") return;
        const distNum = parseFloat(d.distance) || 0;
        const distUnit = /km/i.test(d.distance || "") ? "km" : "mi";
        legs.push({
          day: `Day ${dayNum}`, from: d.origin?.name || d.from || "",
          to: d.destination?.name || d.to || "",
          distance: distNum, unit: distUnit,
          duration: d.duration || "",
          durationH: parseDurationHours(d.duration),
          _dayNum: dayNum, _time: d.time || "", _itemId: d.id,
        });
      });
    });
  }
  return legs.sort((a, b) => a._dayNum !== b._dayNum
    ? a._dayNum - b._dayNum
    : (a._time || "").localeCompare(b._time || ""));
}

export function collectVehicleSegments(kind, savedRoutes, savedDirections, allVehicles) {
  const seenIds = new Set();
  const segments = [];
  const allVehiclesArr = allVehicles ?? [];

  Object.values(kind === "boat" ? (savedRoutes ?? {}) : (savedDirections ?? {})).flat().forEach(item => {
    if (!item.vehicleId) return;
    if (kind === "car" && item.travelMode !== "DRIVING") return;
    if (kind === "boat" && (!item.hrs || item.hrs <= 0)) return;
    if (!seenIds.has(item.vehicleId)) seenIds.add(item.vehicleId);
  });

  seenIds.forEach(id => {
    const vehicle = allVehiclesArr.find(v => v.id === id);
    if (!vehicle || vehicle.kind !== kind) return;
    const legs = buildLegsForVehicle(id, kind, savedRoutes, savedDirections);
    if (!legs.length) return;
    segments.push({ vehicle, legs });
  });

  return segments.sort((a, b) => (a.legs[0]?._dayNum ?? 0) - (b.legs[0]?._dayNum ?? 0));
}
