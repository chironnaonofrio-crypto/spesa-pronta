# V27.9 - Hard Reset cache/deploy

Questa versione serve quando il telefono continua a caricare la versione vecchia.

Cambiamenti:
- CSS e JS rinominati con file nuovi: `styles.v27-9-hard-reset.css` e `app.v27-9-hard-reset.js`;
- service worker disattivato e auto-rimosso;
- `clear-cache.html` non cancella dati utente, cancella solo cache/service worker;
- server aggiornato con header `no-store` per HTML/CSS/JS/service-worker;
- marker interno V27.9 per verificare il deploy.

Dopo il deploy aprire: `https://spesa-pronta.it/clear-cache.html`
