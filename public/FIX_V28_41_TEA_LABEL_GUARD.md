# FIX V28.41 Tea Label Guard + Local Fallback Safety

Questa versione corregge un errore reale visto su una bottiglia Blues THÉ Fusion:

- il fallback locale non può più inventare "Bibita tipo cola" solo per colore rosso/arancio dell etichetta;
- se non legge l etichetta, crea una scheda prudente "Bevanda in bottiglia da identificare";
- la categoria online non può trasformare una scheda generica in "bibite gassate" senza prove forti tipo Coca-Cola/Pepsi/Fanta/Sprite/gassata;
- se OCR/server/OpenAI legge tè/thé/the/ice tea/the fusion/pesca/rosa, la categoria viene bloccata su succhi/tè (juice) e non su soft_drinks;
- aggiunta protezione lato server, lato client e category lookup;
- aggiornato service worker/cache a V28.41.

Controlli eseguiti:

- node --check server.js
- node --check assets/app.v27-48-premium-mega-vision.js
- node --check assets/app.js
- node --check public/assets/app.v27-48-premium-mega-vision.js
- node --check public/assets/app.js
