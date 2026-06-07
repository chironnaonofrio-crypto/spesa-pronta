# V27.10 - Stop auto-refresh loop

Correzione principale:
- rimosso il reload automatico causato dal service worker V27.9;
- disattivata la registrazione del service worker;
- service-worker.js ora si disinstalla senza `clients.navigate()`;
- rimossi script inline che pulivano cache ad ogni caricamento;
- aggiunti file con nomi nuovi `app.v27-10-stable.js` e `styles.v27-10-stable.css`;
- `clear-cache.html` ora pulisce cache senza redirect automatico continuo.
