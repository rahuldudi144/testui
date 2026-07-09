import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import type { IncomingMessage, ServerResponse } from "node:http";

function isEventStreamResponse(proxyRes: IncomingMessage): boolean {
  const contentType = proxyRes.headers["content-type"];
  return typeof contentType === "string" && contentType.includes("text/event-stream");
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "../dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        secure: false,
        timeout: 300_000,
        proxyTimeout: 300_000,
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const accept = req.headers.accept;
            if (typeof accept === "string" && accept.includes("text/event-stream")) {
              proxyReq.setHeader("accept-encoding", "identity");
            }
          });
          proxy.on("proxyRes", (proxyRes, req, res) => {
            const response = res as ServerResponse;
            const isSse = isEventStreamResponse(proxyRes);
            const headers = { ...proxyRes.headers };

            if (isSse) {
              headers["cache-control"] = "no-cache, no-transform";
              headers["x-accel-buffering"] = "no";
              delete headers["content-encoding"];
              delete headers["content-length"];
            }

            response.writeHead(proxyRes.statusCode ?? 200, headers);
            proxyRes.pipe(response);
          });
        },
      },
    },
  },
});
