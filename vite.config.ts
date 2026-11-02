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
      includeAssets: ['icon.svg', 'icon-180.png'],
      manifest: {
        name: 'Hofmanager SchweikFarm',
        short_name: 'SchweikFarm',
        description: 'Hofmanager SchweikFarm – Betriebsführung für Feld, Lager und Maschinen',
        lang: 'de-CH',
        start_url: '/',
        display: 'standalone',
        background_color: '#F4F1E8',
        theme_color: '#1F4D2E',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Nur die App-Hülle wird zwischengespeichert; Betriebsdaten kommen immer frisch aus der Datenbank.
        navigateFallback: '/index.html',
      },
    }),
  ],
});
