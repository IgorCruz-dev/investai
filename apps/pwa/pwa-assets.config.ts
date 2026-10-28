import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Gera os PNGs do PWA a partir de public/icon.svg: npm run icones
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    // Maskable e iPhone recortam o ícone: fundo preto até a borda, sem canto transparente
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0c0c0d' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0c0c0d' } },
  },
  images: ['public/icon.svg'],
})
