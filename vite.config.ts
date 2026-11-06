import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  root: "client",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": path.resolve("shared") } },
  build: { outDir: "../dist/client", emptyOutDir: true },
});
