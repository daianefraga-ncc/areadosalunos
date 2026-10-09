/*
  Service worker da Área do Aluno (NCC Plat).
  Dois papéis: (1) fazer o navegador considerar o site "instalável" (ícone na tela
  de início do celular) — ele NÃO guarda os dados dos alunos em cache, sempre busca
  a versão mais nova na internet primeiro; (2) receber notificações push do servidor
  e mostrá-las mesmo com o app/navegador fechado.
*/

const CACHE_NAME = 'ncc-plat-shell-v3';
const SHELL_FILES = [
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

// Busca na rede, mas sem esperar pra sempre: se a internet do aluno estiver
// lenta/instável e a resposta não chegar em 35s, desiste e cai pro cache (ou
// erro) em vez de deixar a página "carregando" ou em branco indefinidamente.
// 35s (em vez de um valor mais curto) porque o arquivo principal do site é
// grande e, numa conexão ruim, pode legitimamente demorar bastante — um
// limite curto demais fazia o aluno cair num cache antigo antes mesmo da
// versão nova terminar de chegar.
function fetchComTempoLimite(request, ms) {
  return new Promise((resolve, reject) => {
    let resolvido = false;
    const timer = setTimeout(() => {
      if (!resolvido) { resolvido = true; reject(new Error('timeout')); }
    }, ms);
    fetch(request).then((response) => {
      if (!resolvido) { resolvido = true; clearTimeout(timer); resolve(response); }
    }).catch((err) => {
      if (!resolvido) { resolvido = true; clearTimeout(timer); reject(err); }
    });
  });
}

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
// só usa o que está salvo (cache) se o aluno estiver sem internet ou se a
// rede demorar demais pra responder.
//
// Só entra em ação para arquivos do próprio site (HTML, manifest, ícones).
// Chamadas pra API (Supabase) NUNCA passam por aqui — isso evita cache de
// dados do aluno e evita que uma instabilidade na API trave o carregamento
// da página.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetchComTempoLimite(event.request, 35000)
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

// Chega um push do servidor (via enviar-push-pendentes) mesmo com o app fechado.
// O payload é um JSON simples: { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Área do Aluno NCC';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Toca na notificação: abre o app (ou foca a aba já aberta) na URL informada.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
