/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        palm: {
          bg: '#FFF5F7',
          card: '#ffffff',
          border: '#F0D0D8',
          accent: '#E88FAC',
          'accent-hover': '#d4789a',
          muted: '#FFF0F3',
          'input-border': '#E8C4CC',
        }
      }
    }
  },
  plugins: [],
}
