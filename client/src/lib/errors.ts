export function describeFetchError(
  err: unknown,
  messages: { network: string; unknown: string },
): string {
  // Fetch always rejects with a TypeError for network-level failures (offline,
  // DNS, CORS, connection refused) — the exact message text differs per
  // browser ("Failed to fetch" in Chromium, "NetworkError..." in Firefox,
  // "Load failed" in Safari), so match on the error type instead of the text.
  if (err instanceof TypeError) return messages.network;
  if (err instanceof Error) return err.message;
  return messages.unknown;
}
