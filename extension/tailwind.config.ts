import type { Config } from "tailwindcss";

export default {
  content: ["./popup.html", "./src/popup/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
