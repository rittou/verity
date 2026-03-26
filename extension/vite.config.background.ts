import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    define: {
      __PROXY_URL__: JSON.stringify(
        env.VITE_PROXY_URL || "http://localhost:3000",
      ),
    },
    build: {
      outDir: "dist",
      emptyOutDir: false,
      rollupOptions: {
        input: {
          "service-worker": resolve(
            __dirname,
            "src/background/service-worker.ts",
          ),
        },
        output: {
          format: "iife",
          entryFileNames: "[name].js",
        },
      },
    },
  };
});
