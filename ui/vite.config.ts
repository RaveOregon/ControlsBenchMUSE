import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The replay fixtures live outside ui/ (artifacts/ and codesys/artifacts/); allow Vite to read them.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    fs: { allow: [repoRoot] }
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4000
  }
});
