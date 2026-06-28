function isTauri() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/**
 * @param {{ onStatus: (status: string) => void, onEvent: (event: object) => void }} handlers
 * @returns {Promise<"tauri" | "web">}
 */
export async function subscribeStream(handlers) {
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen("stream-status", (event) => {
      handlers.onStatus(event.payload);
    });
    await listen("packet-event", (event) => {
      try {
        handlers.onEvent(JSON.parse(event.payload));
      } catch {
        // Malformed lines are ignored so a single bad event does not stop the dashboard.
      }
    });
    return "tauri";
  }

  return "web";
}
