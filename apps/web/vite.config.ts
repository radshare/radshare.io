import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * In development the SvelteKit dev server and the Bun host are two processes,
 * so `/api` and `/ws` are proxied to keep them on one origin — the same
 * arrangement Caddy provides in production, where one Bun process serves the
 * built client and terminates the socket itself.
 */
const HOST = process.env.RADSHARE_SERVER ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    proxy: {
      "/api": { target: HOST, changeOrigin: true },
      "/ws": { target: HOST, ws: true, changeOrigin: true },
    },
  },
});
