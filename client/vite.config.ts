import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { IncomingMessage, ServerResponse } from "node:http";

const clientDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(clientDir, "../.env") });

function devApiTarget(): string {
  const portFile = path.resolve(clientDir, "../.dev-api-port");
  try {
    const fromFile = Number(fs.readFileSync(portFile, "utf8").split("\n")[0]?.trim());
    if (Number.isInteger(fromFile) && fromFile > 0 && fromFile <= 65535) {
      return `http://127.0.0.1:${fromFile}`;
    }
  } catch {
    // Server has not published a port yet.
  }

  const fromEnv = Number(process.env.TESTUI_PORT ?? 4000);
  const port =
    Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv <= 65535
      ? fromEnv
      : 4000;
  return `http://127.0.0.1:${port}`;
}

function isEventStreamResponse(proxyRes: IncomingMessage): boolean {
  const contentType = proxyRes.headers["content-type"];
  return typeof contentType === "string" && contentType.includes("text/event-stream");
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: clientDir,
  build: {
    outDir: path.resolve(clientDir, "../dist"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    // Reverse-proxied prod host + any *.dev4fun.science subdomain.
    allowedHosts: [
      "test-clinora.dev4fun.science",
      ".dev4fun.science",
    ],
    proxy: {
      "/api": {
        target: devApiTarget(),
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
          proxy.on("proxyRes", (proxyRes, _req, res) => {
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
