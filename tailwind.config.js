/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/renderer/**/*.{html,js}"
  ],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#1e1e1e',
        'dark-panel': '#252526',
        'dark-input': '#3c3c3c',
        'dark-hover': '#2d2d2d',
        'dark-border': '#3e3e42',
        'accent-blue': '#007acc',
        'accent-teal': '#4ec9b0',
        'accent-purple': '#c586c0',
        'text-primary': '#d4d4d4',
        'text-secondary': '#858585',
        'log-error': '#f48771',
        'log-warning': '#dcdcaa',
        'log-info': '#9cdcfe',
        'log-debug': '#4ec9b0',
        'log-verbose': '#858585',
        'log-fatal': '#ff0000',
        'log-timestamp': '#608b4e',
      }
    },
  },
  plugins: [],
}
