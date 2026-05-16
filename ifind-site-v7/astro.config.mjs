import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site: 'https://ifind.fr',
  base: '/design/v7',
  trailingSlash: 'ignore',
  compressHTML: true,
  prefetch: { defaultStrategy: 'viewport' },
  vite: {
    build: { target: 'esnext' },
    ssr: { noExternal: ['three', 'gsap', 'lenis', 'tone'] },
  },
});
