/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#06090f",
        surface: "#0d1320",
        "surface-alt": "#141d2f",
        border: "#1c2a45",
        accent: "#4d8eff",
        "accent-soft": "rgba(77,142,255,0.12)",
        "text-primary": "#dfe6f0",
        "text-muted": "#7e93b5",
        "text-dim": "#3d5278",
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'IBM Plex Mono'", "monospace"],
        display: ["'Outfit'", "'Space Grotesk'", "sans-serif"],
      },
    },
  },
  plugins: [],
};
