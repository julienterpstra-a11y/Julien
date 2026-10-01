import { useMemo } from "react";
import OpeningHours from "opening_hours";

export default function OpeningHoursBadge({ value }: { value?: string }) {
  const state = useMemo(() => {
    if (!value) return null;
    try {
      const oh = new OpeningHours(value);
      const isOpen = oh.getState();
      const comment = oh.getComment();
      return { isOpen, comment };
    } catch {
      return { isOpen: null, comment: undefined };
    }
  }, [value]);

  if (!value) {
    return <span className="badge badge-unknown">Openingstijden onbekend</span>;
  }

  if (!state || state.isOpen === null) {
    return <span className="badge badge-unknown">{value}</span>;
  }

  return (
    <span className={state.isOpen ? "badge badge-open" : "badge badge-closed"}>
      {state.isOpen ? "Nu open" : state.comment ?? "Nu gesloten"}
    </span>
  );
}
