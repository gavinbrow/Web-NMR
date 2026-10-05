import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  resolve: {
    // Runtime WASM files are served explicitly from local public assets.
    conditions: [
      "onnxruntime-web-use-extern-wasm",
      "module",
      "browser",
      "development|production",
    ],
  },
  build: { target: "es2022" },
  server: { port: 5173, strictPort: true },
});
