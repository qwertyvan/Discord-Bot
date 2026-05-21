import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        discord: {
          DEFAULT: '#5865F2',
          dark: '#404eed',
        },
      },
    },
  },
  plugins: [],
};

export default config;
