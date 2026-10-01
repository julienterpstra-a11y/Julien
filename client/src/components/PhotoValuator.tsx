import { useState, type ChangeEvent } from "react";
import { describeFetchError } from "../lib/errors";

interface ValuationResult {
  item: string;
  conditie: string;
  waarde_min: number;
  waarde_max: number;
  toelichting: string;
  zekerheid: "laag" | "gemiddeld" | "hoog";
}

type Status = "idle" | "loading" | "done" | "error";

export default function PhotoValuator() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValuationResult | null>(null);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setResult(null);
    setStatus("idle");
    setError(null);
    setPreviewUrl(URL.createObjectURL(selected));
  };

  const submit = async () => {
    if (!file) return;
    setStatus("loading");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("photo", file);

      const response = await fetch("/api/valuate", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Waardebepaling is mislukt.");
      }

      setResult(data.result as ValuationResult);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(
        describeFetchError(err, {
          network:
            "Kon geen verbinding maken met de server. Controleer je internetverbinding en probeer het opnieuw.",
          unknown: "Onbekende fout bij het waarderen.",
        }),
      );
    }
  };

  return (
    <section className="panel">
      <p>
        Upload een foto van een voorwerp en krijg een indicatie van de actuele tweedehandswaarde.
        Dit is een schatting op basis van een AI-model &mdash; geen officiële taxatie.
      </p>

      <label className="file-input">
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={onFileChange} />
        Kies een foto
      </label>

      {previewUrl && (
        <div className="preview">
          <img src={previewUrl} alt="Voorbeeld van geüploade foto" />
        </div>
      )}

      <button className="primary-button" onClick={submit} disabled={!file || status === "loading"}>
        {status === "loading" ? "Bezig met waarderen..." : "Bepaal actuele waarde"}
      </button>

      {status === "error" && error && <p className="error-text">{error}</p>}

      {status === "done" && result && (
        <div className="valuation-card">
          <h3>{result.item}</h3>
          <p className="valuation-price">
            € {result.waarde_min} &ndash; € {result.waarde_max}
          </p>
          <p>
            Conditie: {result.conditie} &middot; Zekerheid: {result.zekerheid}
          </p>
          <p>{result.toelichting}</p>
          <p className="disclaimer">
            Indicatieve schatting, geen getaxeerde waarde. Werkelijke opbrengst hangt af van staat,
            vraag en aanbod en de specifieke kringloopwinkel.
          </p>
        </div>
      )}
    </section>
  );
}
