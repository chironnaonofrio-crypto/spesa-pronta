# Fix V27.6 - Cache killer

Serve quando il telefono continua a mostrare la vecchia pagina.

Cambiamenti:
- cache-busting a v27.6 per CSS e JS;
- service worker aggiornato con rete prima della cache;
- cancellazione automatica delle vecchie cache;
- aggiunta pagina `clear-cache.html` per svuotare manualmente cache/service worker.

Dopo deploy, aprire: `/clear-cache.html` una volta, poi tornare alla home.
