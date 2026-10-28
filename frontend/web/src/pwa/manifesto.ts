// PUB-03 (T156): manifest do PWA, gravado pelo vite-plugin-pwa (vite.config.ts) em
// /manifest.webmanifest. Arquivo sem imports para o teste poder lê-lo.
// PREMISSA: ícones provisórios (quadrado verde liso, sem marca): ocupam a tela inteira, então a
// zona de segurança do maskable não corta nada. Trocar pela marca quando houver.
interface Icone {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

export const manifesto: {
  name: string;
  short_name: string;
  lang: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  background_color: string;
  theme_color: string;
  icons: Icone[];
} = {
  name: 'Evolução Segura',
  short_name: 'Evolução Segura',
  lang: 'pt-BR',
  start_url: '/app',
  scope: '/',
  display: 'standalone',
  background_color: '#215f4b',
  theme_color: '#215f4b',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
