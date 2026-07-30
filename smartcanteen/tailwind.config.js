/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // This defines the "primary" color used in your buttons and charts
        primary: {
          DEFAULT: '#0f766e',
          dark: '#0d5f59',
          light: '#99f6e4',
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
