/* Funciona sem internet depois da primeira visita: guarda a tela no aparelho.
   Sempre tenta a versão mais nova primeiro (rede) e só usa a cópia guardada
   quando está sem conexão. Nunca guarda nada de /api/. */
"use strict";
const CACHE = "apontamentos-v2";
const ARQUIVOS = [
  "./", "index.html", "estilo.css", "app.js", "manifest.webmanifest",
  "local/conteudo.js", "local/conferencia.js", "local/ia.js", "local/servidor-local.js",
  "local/gerador-pdf.js", "local/gerador-docx.js", "vendor/jspdf.umd.min.js", "vendor/docx.min.js",
  "marca/logo_claro.png", "marca/emblema.png", "marca/icone.png", "marca/app-180.png", "marca/app-192.png",
  "marca/Cinzel-Bold.ttf", "marca/Cinzel-Medium.ttf", "marca/LiberationSans-Regular.ttf",
  "marca/LiberationSans-Bold.ttf", "marca/LiberationSans-Italic.ttf",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).catch(() => null).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return;
  ev.respondWith(fetch(ev.request).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(ev.request, copia)); }
    return r;
  }).catch(() => caches.match(ev.request, { ignoreSearch: true })
    .then(r => r || caches.match("index.html"))));
});
