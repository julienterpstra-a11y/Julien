import { useCallback, useState } from "react";
import { findNearbyKringloopwinkels, type KringloopPlace } from "../lib/overpass";
import OpeningHoursBadge from "./OpeningHoursBadge";

type Status = "idle" | "locating" | "loading" | "done" | "error";

export default function KringloopFinder() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<KringloopPlace[]>([]);

  const search = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Je browser ondersteunt geen locatiebepaling.");
      return;
    }

    setStatus("locating");
    setError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setStatus("loading");
        try {
          const { latitude, longitude } = position.coords;
          const results = await findNearbyKringloopwinkels(latitude, longitude);
          setPlaces(results);
          setStatus("done");
        } catch (err) {
          setStatus("error");
          const message = err instanceof Error ? err.message : "";
          setError(
            message && message !== "Failed to fetch"
              ? message
              : "Kon geen verbinding maken met de kaartendienst. Controleer je internetverbinding en probeer het opnieuw.",
          );
        }
      },
      () => {
        setStatus("error");
        setError("Locatie kon niet bepaald worden. Geef toestemming voor locatietoegang.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  return (
    <section className="panel">
      <p>
        Zoek de dichtstbijzijnde kringloopwinkels binnen 15 km, inclusief openingstijden. We
        gebruiken je locatie alleen om te zoeken &mdash; die wordt niet opgeslagen.
      </p>

      <button className="primary-button" onClick={search} disabled={status === "locating" || status === "loading"}>
        {status === "locating"
          ? "Locatie bepalen..."
          : status === "loading"
            ? "Zoeken..."
            : "Zoek kringloopwinkels bij mij in de buurt"}
      </button>

      {status === "error" && error && <p className="error-text">{error}</p>}

      {status === "done" && places.length === 0 && (
        <p>Geen kringloopwinkels gevonden binnen 15 km.</p>
      )}

      <ul className="place-list">
        {places.map((place) => (
          <li key={place.id} className="place-card">
            <div className="place-card-header">
              <h3>{place.name}</h3>
              <span className="distance">{place.distanceKm.toFixed(1)} km</span>
            </div>
            {place.address && <p className="address">{place.address}</p>}
            <OpeningHoursBadge value={place.openingHours} />
            <div className="place-links">
              <a
                href={`https://www.openstreetmap.org/directions?to=${place.lat},${place.lon}`}
                target="_blank"
                rel="noreferrer"
              >
                Route
              </a>
              {place.website && (
                <a href={place.website} target="_blank" rel="noreferrer">
                  Website
                </a>
              )}
              {place.phone && <a href={`tel:${place.phone}`}>{place.phone}</a>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
