export interface KringloopPlace {
  id: number;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
  address: string;
  openingHours?: string;
  website?: string;
  phone?: string;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const RADIUS_METERS = 15000;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatAddress(tags: Record<string, string>): string {
  const street = tags["addr:street"];
  const number = tags["addr:housenumber"];
  const city = tags["addr:city"];
  const postcode = tags["addr:postcode"];
  const parts = [
    [street, number].filter(Boolean).join(" "),
    [postcode, city].filter(Boolean).join(" "),
  ].filter(Boolean);
  return parts.join(", ");
}

interface OverpassElement {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function findNearbyKringloopwinkels(
  lat: number,
  lon: number,
): Promise<KringloopPlace[]> {
  const query = `
    [out:json][timeout:25];
    (
      nwr["shop"="charity"](around:${RADIUS_METERS},${lat},${lon});
      nwr["shop"="second_hand"](around:${RADIUS_METERS},${lat},${lon});
      nwr["name"~"kringloop",i](around:${RADIUS_METERS},${lat},${lon});
    );
    out center tags;
  `;

  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });

  if (!response.ok) {
    throw new Error(`Overpass API gaf een fout (${response.status})`);
  }

  const data: { elements: OverpassElement[] } = await response.json();

  const seen = new Set<number>();
  const places: KringloopPlace[] = [];

  for (const el of data.elements) {
    if (seen.has(el.id)) continue;
    seen.add(el.id);

    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat === undefined || elLon === undefined) continue;

    const tags = el.tags ?? {};
    const name = tags.name ?? "Kringloopwinkel (naam onbekend)";

    places.push({
      id: el.id,
      name,
      lat: elLat,
      lon: elLon,
      distanceKm: haversineKm(lat, lon, elLat, elLon),
      address: formatAddress(tags),
      openingHours: tags.opening_hours,
      website: tags.website ?? tags["contact:website"],
      phone: tags.phone ?? tags["contact:phone"],
    });
  }

  return places.sort((a, b) => a.distanceKm - b.distanceKm);
}
