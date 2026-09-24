/*
  Service worker mínimo da Área do Aluno (NCC Plat).
  Objetivo único: fazer o navegador considerar o site "instalável" (ícone na tela
  de início do celular). Ele NÃO guarda os dados dos alunos em cache — sempre
  busca a versão mais nova na internet primeiro, então continuar funcionando
  igual, mesmo instalado como app.
*/

const CACHE_NAME = 'ncc-plat-shell-v1';
const SHELL_FILES = [
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Estratégia "network-first": sempre tenta buscar a versão mais nova online;
// só usa o que está salvo (cache) se o aluno estiver sem internet.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          try { cache.put(event.request, copy); } catch (e) {}
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
