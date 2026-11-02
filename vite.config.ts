import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Hofmanager Schweikhof',
        short_name: 'Hofmanager',
        description: 'Betriebsführung für den Schweikhof',
        lang: 'de-CH',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F1E8',
        theme_color: '#1F4D2E',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        // Nur die App-Hülle wird zwischengespeichert; Betriebsdaten kommen immer frisch aus der Datenbank.
        navigateFallback: '/index.html',
      },
    }),
  ],
});
