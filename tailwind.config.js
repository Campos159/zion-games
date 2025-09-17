/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html","./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:"#e6f2fb",100:"#cfe7f8",200:"#9fd0f1",300:"#6fb9ea",400:"#3fa2e3",
          500:"#1689da",600:"#0076D6",700:"#0065b6",800:"#005497",900:"#003d6d",
        },
        surface: { bg: "#FEFEFF" }
      },
      borderRadius: { '2xl': '1.25rem' },
      boxShadow: { card: "0 8px 30px rgba(0,0,0,.06)" }
    },
  },
  plugins: [],
}
