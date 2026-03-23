/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        palm: {
          dark: '#0a0a0a',
          card: '#111111',
          border: '#222222',
          accent: '#c8a96e',
        }
      }
    }
  },
  plugins: [],
}
