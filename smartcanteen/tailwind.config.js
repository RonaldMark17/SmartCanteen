/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // This defines the "primary" color used in your buttons and charts
        primary: {
          DEFAULT: '#d946ef', // Tailwind's fuchsia-500
          dark: '#c026d3',    // Tailwind's fuchsia-600
          light: '#f0abfc',   // Tailwind's fuchsia-300
        }
      },
      fontFamily: {
        // Optional: If you want to force a specific font, define it here
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}