import { defineConfig } from "vite";

/** GitHub Pages: https://<user>.github.io/packet-journey/ */
const base = process.env.GITHUB_PAGES === "true" ? "/packet-journey/" : "/";
const buildId = process.env.GITHUB_SHA?.slice(0, 7) ?? "local";

export default defineConfig({
  base,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  preview: {
    port: 4173,
    strictPort: true,
    host: "127.0.0.1",
    open: true,
  },
});
