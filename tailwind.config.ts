import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#E91E63',
        secondary: '#0F172A',
        background: '#F8FAFC',
      },
    },
  },
  plugins: [],
}

export default config
