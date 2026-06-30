import { defineConfig } from "vite";

/** GitHub Pages: https://<user>.github.io/xdp-hello/ */
const base = process.env.GITHUB_PAGES === "true" ? "/xdp-hello/" : "/";
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
