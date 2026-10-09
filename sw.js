/*
  Service worker da Área do Aluno (NCC Plat).
  Dois papéis: (1) fazer o navegador considerar o site "instalável" (ícone na tela
  de início do celular) — ele NÃO guarda os dados dos alunos em cache, sempre busca
  a versão mais nova na internet primeiro (para o HTML principal); (2) receber
  notificações push do servidor e mostrá-las mesmo com o app/navegador fechado.
*/

const CACHE_NAME = 'ncc-plat-shell-v5';

// Arquivos "estáticos" (bibliotecas, ícones, manifest): praticamente nunca mudam
// de conteúdo sem que a gente troque o CACHE_NAME também, então é seguro servir
// direto do cache sem esperar a rede. Isso evita que uma internet lenta/instável
// force o navegador a esperar (possivelmente vários segundos, em cada um deles)
// antes de cada um desses arquivos aparecer — o que, somado (vários arquivos),
// podia travar a página inteira por mais de um minuto.
const STATIC_FILES = [
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './supabase.min.js',
  './xlsx.full.min.js',
  './pptxgen.bundle.js',
  './pdf.min.mjs',
  './pdf.worker.min.mjs'
];

// O HTML principal é o único arquivo que realmente precisa ser buscado na rede
// primeiro (pra sempre pegar a versão mais nova do site assim que publicada),
// com um limite de tempo generoso antes de desistir e cair pro cache. Por isso
// ele NÃO entra na lista de pré-carregamento abaixo: se entrasse, o navegador
// buscaria esse arquivo grande DUAS VEZES ao mesmo tempo assim que o site
// abrisse — uma vez pela navegação normal (com limite de tempo, abaixo) e
// outra vez aqui no install, essa segunda sem nenhum limite de tempo — as
// duas competindo e podendo travar a página esperando por mais de um minuto.
// Ele só é guardado em cache reativamente, pela função de 'fetch' abaixo.
const APP_SHELL_HTML = './index.html';

const SHELL_FILES = STATIC_FILES;

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
    caches.open(CACHE_NAME).then((cache) =>
      // Busca cada arquivo individualmente (em vez de cache.addAll, que desiste
      // de TUDO se um único arquivo falhar) — assim, se algum ícone ou arquivo
      // falhar nessa primeira busca, os outros ainda ficam guardados.
      Promise.all(
        SHELL_FILES.map((url) =>
          fetch(url).then((resp) => {
            if (resp && resp.ok) return cache.put(url, resp);
          }).catch(() => {})
        )
      )
    )
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

// Só entra em ação para arquivos do próprio site (HTML, manifest, ícones,
// bibliotecas). Chamadas pra API (Supabase) NUNCA passam por aqui — isso evita
// cache de dados do aluno e evita que uma instabilidade na API trave o
// carregamento da página.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  const ehHtmlPrincipal =
    event.request.mode === 'navigate' ||
    reqUrl.pathname === '/' ||
    reqUrl.pathname.endsWith('/index.html');

  if (ehHtmlPrincipal) {
    // Network-first com limite de tempo: sempre tenta a versão mais nova;
    // só usa o cache se a rede demorar demais (35s) ou falhar.
    event.respondWith(
      fetchComTempoLimite(event.request, 35000)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try { cache.put(event.request, copy); } catch (e) {}
          });
          return response;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match(APP_SHELL_HTML)))
    );
    return;
  }

  // Tudo que não é o HTML principal (bibliotecas, manifest, ícones): cache-first.
  // Se já está guardado, responde na hora, sem nenhuma espera de rede — é isso
  // que evita a tela travada enquanto o navegador espera arquivo por arquivo.
  // Só busca na rede se ainda não tiver esse arquivo guardado.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetchComTempoLimite(event.request, 20000)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            try { cache.put(event.request, copy); } catch (e) {}
          });
          return response;
        })
        .catch(() => caches.match(event.request));
    })
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
