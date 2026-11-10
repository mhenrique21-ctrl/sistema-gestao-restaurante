/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#1c140e',
        surface: '#251b13',
        'surface-2': '#2c2117',
        line: '#3a2c1e',
        cream: '#f3e9da',
        'cream-soft': '#c9b89f',
        gold: '#cf9a4f',
        'gold-dark': '#a9793c',
        err: '#a5453f',
        success: '#7db98a',
        ink: '#241a10',
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body: ['Inter', 'sans-serif'],
        price: ['"JetBrains Mono"', 'monospace'],
      },
      keyframes: {
        railBounce: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(4px)' } },
        slideDown: {
          from: { opacity: 0, transform: 'translate(-50%,-14px)' },
          to: { opacity: 1, transform: 'translate(-50%,0)' },
        },
      },
      animation: {
        railBounce: 'railBounce 1.6s ease-in-out infinite',
        slideDown: 'slideDown .35s cubic-bezier(.22,.9,.32,1)',
      },
    },
  },
  plugins: [],
};
