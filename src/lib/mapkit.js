let mapkitPromise = null;

export function getStoredProviderSettings() {
  try {
    const s = localStorage.getItem("travelSettings");
    const p = s ? JSON.parse(s) : {};
    return {
      provider:         p.mapsProvider      ?? "google",
      googleMapsKey:    p.googleMapsKey      ?? "",
      appleMapKitToken: p.appleMapKitToken   ?? "",
    };
  } catch {
    return { provider: "google", googleMapsKey: "", appleMapKitToken: "" };
  }
}

export function loadMapKit(jwt) {
  if (!jwt) return Promise.reject(new Error("no-token"));
  if (!mapkitPromise) {
    mapkitPromise = new Promise((resolve, reject) => {
      if (window.mapkit) { initMapKit(jwt, resolve); return; }
      const script = document.createElement("script");
      script.src = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";
      script.crossOrigin = "anonymous";
      script.onload  = () => initMapKit(jwt, resolve);
      script.onerror = () => reject(new Error("load-failed"));
      document.head.appendChild(script);
    });
  }
  return mapkitPromise;
}

function initMapKit(jwt, resolve) {
  window.mapkit.init({ authorizationCallback: done => done(jwt), language: "en" });
  resolve(window.mapkit);
}

function mkRegion(mk, bias) {
  const span = new mk.CoordinateSpan(9, 9); // ~500 km
  return new mk.CoordinateRegion(new mk.Coordinate(bias.lat, bias.lng), span);
}

export function appleAutocomplete(mk, query, locationBias = null) {
  return new Promise(resolve => {
    const opts = locationBias ? { region: mkRegion(mk, locationBias) } : {};
    const search = new mk.Search(opts);
    search.autocomplete(query, (err, data) => {
      if (err || !data?.results?.length) { resolve([]); return; }
      resolve(
        data.results.slice(0, 5).map(r => ({
          name:     r.displayLines[0] ?? "",
          subtitle: r.displayLines[1] ?? "",
          _data:    r,
        }))
      );
    });
  });
}

export function appleFetchPlaceDetails(mk, autocompleteResult) {
  return new Promise((resolve, reject) => {
    const search = new mk.Search();
    search.search(autocompleteResult, (err, data) => {
      if (err || !data?.places?.length) { reject(err || new Error("no-results")); return; }
      const place = data.places[0];
      const lat = place.coordinate.latitude;
      const lng = place.coordinate.longitude;
      resolve({
        name:     place.name ?? "",
        address:  place.formattedAddress ?? "",
        phone:    "",
        website:  "",
        placeId:  `ll:${lat},${lng}`,
        category: detectAppleCategory(place.pointOfInterestCategory),
      });
    });
  });
}

const APPLE_CATEGORY_MAP = {
  Restaurant: "restaurant", Cafe: "restaurant", Bakery: "restaurant", FoodMarket: "restaurant",
  Marina: "marina", BoatRamp: "marina", GasStation: "marina",
  Hotel: "accommodation",
  Grocery: "provisioning", Supermarket: "provisioning", ConvenienceStore: "provisioning",
  Park: "activity", Museum: "activity", Beach: "activity", NationalPark: "activity",
  Aquarium: "activity", Zoo: "activity", AmusementPark: "activity",
};

export function detectAppleCategory(appleCategory) {
  if (!appleCategory) return "other";
  return APPLE_CATEGORY_MAP[appleCategory] ?? "other";
}

function resolveToCoordinate(mk, autocompleteResult) {
  return new Promise((resolve, reject) => {
    new mk.Search().search(autocompleteResult, (err, data) => {
      if (err || !data?.places?.length) {
        reject(err || new Error("no-place"));
        return;
      }
      resolve(data.places[0].coordinate);
    });
  });
}

export async function appleFetchDirections(mk, originData, destData, travelMode) {
  const [originCoord, destCoord] = await Promise.all([
    resolveToCoordinate(mk, originData),
    resolveToCoordinate(mk, destData),
  ]);

  return new Promise((resolve, reject) => {
    const transportType = travelMode === "WALKING"
      ? mk.Directions.Transport.Walking
      : mk.Directions.Transport.Automobile;
    new mk.Directions().route({ origin: originCoord, destination: destCoord, transportType }, (err, data) => {
      if (err || !data?.routes?.length) {
        reject(err || new Error("no-route"));
        return;
      }
      const route = data.routes[0];
      resolve({
        distance: formatDistance(route.distance),
        duration: formatDuration(route.expectedTravelTime),
        summary:  "",
        steps: (route.steps ?? []).map(s => ({
          instruction: s.instructions ?? "",
          distance:    formatDistance(s.distance),
          duration:    "",
        })),
      });
    });
  });
}

function formatDistance(meters) {
  if (!meters) return "";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function applePlaceMapsUrl(place) {
  if (place.placeId?.startsWith("ll:")) {
    const [lat, lng] = place.placeId.slice(3).split(",");
    return `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(place.name)}`;
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(place.name)}`;
}

export function appleDirectionsMapsUrl(dir) {
  const dirflg = dir.travelMode === "WALKING" ? "w" : "d";
  return `https://maps.apple.com/?saddr=${encodeURIComponent(dir.origin.name)}&daddr=${encodeURIComponent(dir.destination.name)}&dirflg=${dirflg}`;
}
