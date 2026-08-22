import { useState } from "react";
import KringloopFinder from "./components/KringloopFinder";
import PhotoValuator from "./components/PhotoValuator";

type Tab = "vinden" | "waarderen";

export default function App() {
  const [tab, setTab] = useState<Tab>("vinden");

  return (
    <div className="app">
      <header className="app-header">
        <h1>♻️ Kringloop App</h1>
        <p>Vind een kringloopwinkel bij jou in de buurt en check wat je spullen waard zijn</p>
      </header>

      <nav className="tabs">
        <button
          className={tab === "vinden" ? "tab active" : "tab"}
          onClick={() => setTab("vinden")}
        >
          Kringloopwinkels
        </button>
        <button
          className={tab === "waarderen" ? "tab active" : "tab"}
          onClick={() => setTab("waarderen")}
        >
          Foto waarderen
        </button>
      </nav>

      <main>{tab === "vinden" ? <KringloopFinder /> : <PhotoValuator />}</main>
    </div>
  );
}
