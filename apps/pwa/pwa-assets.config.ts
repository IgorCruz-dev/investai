import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Gera os PNGs do PWA a partir de public/icon.svg: npm run icones
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // Maskable e iPhone recortam o ícone: fundo verde até a borda, sem canto transparente
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#059669' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#059669' } },
  },
  images: ['public/icon.svg'],
})
