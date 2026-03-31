import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      screens: {
        'xs': '400px',
      },
      colors: {
        primary: '#E91E63',
        secondary: '#0F172A',
        background: '#F8FAFC',
      },
      keyframes: {
        'foil-shimmer': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '100% 50%' },
        },
        // NUEVA ANIMACIÓN: Mueve el gradiente de fondo
        'gradient-xy': {
          '0%, 100%': {
            'background-size': '200% 200%',
            'background-position': 'left center'
          },
          '50%': {
            'background-size': '200% 200%',
            'background-position': 'right center'
          },
        }
      },
      animation: {
        'foil-shimmer': 'foil-shimmer 3s linear infinite',
        'gradient-xy': 'gradient-xy 3s ease infinite', // Velocidad media
      },
    },
  },
  plugins: [],
}

export default config