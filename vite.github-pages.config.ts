import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github-pages",
  base: "/garna-client-avatar-maker/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../docs",
    emptyOutDir: true,
  },
});
