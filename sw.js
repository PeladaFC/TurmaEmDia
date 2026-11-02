/* Turma em Dia · service worker: só recebe os avisos (notificações push). Não guarda páginas em cache:
   o app continua sempre atualizado pela rede. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// o servidor manda { data: { titulo, corpo, url } } (Firebase Cloud Messaging)
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || (j.notification ? { titulo: j.notification.title, corpo: j.notification.body } : j); } catch (x) { d = { corpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Turma em Dia', {
    body: d.corpo || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.url || 'turma-em-dia', renotify: true, data: { url: d.url || './' }
  }));
});

// tocou no aviso: abre o app (ou traz para frente o que já está aberto) na chamada
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const abertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abertos) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ abrir: alvo }); return; } }
    await self.clients.openWindow(alvo);
  })());
});
