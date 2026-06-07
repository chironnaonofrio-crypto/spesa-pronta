# Spesa Pronta V26 - Fix telefono registrazione

Questa versione forza la comparsa dei campi Prefisso e Numero telefono anche se il browser o Render stanno servendo una vecchia copia dell'HTML.

Correzioni:
- campi telefono in `public/index.html` e anche in `index.html` root;
- assets duplicati in root per compatibilità con `STATIC_DIR=.`;
- cache service worker aggiornata a V26;
- script failsafe che inietta i campi telefono se mancano;
- captcha immagini ricreato se risulta vuoto;
- link CSS/JS aggiornati a `?v=26`.
