export function isTauri() {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

/** Vite 静的ビルド（GitHub Pages）かどうか。 */
export function isWebDemo() {
  return !isTauri();
}

/**
 * @param {{ onStatus: (status: string) => void, onEvent: (event: object) => void }} handlers
 * @returns {Promise<{ mode: "tauri" | "web", unsubscribe: () => void }>}
 */
export async function subscribeStream(handlers) {
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenStatus = await listen("stream-status", (event) => {
      handlers.onStatus(event.payload);
    });
    const unlistenEvent = await listen("packet-event", (event) => {
      try {
        handlers.onEvent(JSON.parse(event.payload));
      } catch {
        // Malformed lines are ignored so a single bad event does not stop the dashboard.
      }
    });
    return {
      mode: "tauri",
      unsubscribe() {
        unlistenStatus();
        unlistenEvent();
      },
    };
  }

  return { mode: "web", unsubscribe() {} };
}
