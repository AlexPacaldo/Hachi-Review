import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from the domain root by Vercel. This used to switch to "/ReviewHub/"
  // for a GitHub Pages build, but GitHub Actions always sets GITHUB_ACTIONS, so
  // that conditional would have mis-built any future CI job instead.
  base: "/"
});
