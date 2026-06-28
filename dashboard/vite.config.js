import { defineConfig } from "vite";

/** GitHub Pages: https://<user>.github.io/xdp-hello/ */
const base = process.env.GITHUB_PAGES === "true" ? "/xdp-hello/" : "/";

export default defineConfig({
  base,
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
});
