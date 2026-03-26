import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: { content: resolve(__dirname, "src/content/index.ts") },
      output: {
        format: "iife",
        entryFileNames: "[name].js",
      },
    },
  },
});
