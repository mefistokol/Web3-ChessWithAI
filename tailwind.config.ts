import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        primary: '#4f46e5',
        secondary: '#0ea5e9',
        dark: '#0f172a',
        darker: '#020617',
      },
    },
  },
  plugins: [],
};

export default config;
