/* Turma em Dia · service worker: só recebe os avisos (notificações push). Não guarda páginas em cache:
   o app continua sempre atualizado pela rede. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// o servidor manda { data: { titulo, corpo, url, acoes?, resp?, api? } } (Firebase Cloud Messaging)
// acoes: botões no aviso (JSON: [{ a, t }]); resp + api: os botões "Vai" / "Não vai" respondem sem abrir o app
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || (j.notification ? { titulo: j.notification.title, corpo: j.notification.body } : j); } catch (x) { d = { corpo: e.data ? e.data.text() : '' }; }
  let acoes = []; try { acoes = d.acoes ? JSON.parse(d.acoes) : []; } catch (x) { }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Turma em Dia', {
    body: d.corpo || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.url || 'turma-em-dia', renotify: true,
    actions: acoes.slice(0, 2).map(x => ({ action: x.a, title: x.t })), data: { url: d.url || './', resp: d.resp || null, api: d.api || null }
  }));
});

const abrir = async url => {
  const alvo = new URL(url || './', self.registration.scope).href;
  const abertos = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of abertos) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ abrir: alvo }); return; } }
  await self.clients.openWindow(alvo);
};

// tocou no aviso: abre o app no lugar certo (pagamento, evento, chamada); tocou em "Vai" / "Não vai": responde na hora
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  if ((e.action === 'interesse' || e.action === 'nao') && d.resp && d.api) {
    e.waitUntil((async () => {
      let ok = false;
      try { const r = await fetch(d.api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ r: d.resp, st: e.action }) }); ok = r.ok; } catch (x) { }
      await self.registration.showNotification(e.notification.title || 'Turma em Dia', ok
        ? { body: e.action === 'nao' ? 'Resposta enviada: não vai. Obrigado!' : 'Resposta enviada: vai! Obrigado!', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.url, data: { url: d.url } }
        : { body: 'Não deu para responder por aqui. Toque para responder pelo app.', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.url, data: { url: d.url } });
    })());
    return;
  }
  e.waitUntil(abrir(d.url));
});
