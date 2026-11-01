import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The replay fixtures live outside ui/ (artifacts/ and codesys/artifacts/); allow Vite to read them.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    fs: { allow: [repoRoot] },
    // Portal host (node scripts/host-portal.js). Without it, /api/host fails and Live uses the V1 window bridge.
    proxy: { "/api": { target: process.env.CONTROLSBENCH_HOST_URL ?? "http://127.0.0.1:5179", changeOrigin: false } }
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4000
  }
});
