# FIX V28.40 Server Brain Memory Console

Modifiche applicate sulla base ufficiale `app-v28-openai-token-min-fix-v2839.zip`.

## Server
- Aggiunta scheda memoria completa per ogni prodotto confermato (`memoryCard`).
- Ogni prodotto ora espone campi compilati e mancanti: nome, marca, formato, categoria, unità, barcode, ingredienti, allergeni, tracce, nutrizione, colori, prove OCR/visive.
- Aggiunta foto profilo tecnica predefinita generata dal server in SVG leggero, senza salvare foto pesanti.
- Aggiunto endpoint protetto: `/api/ai/server-brain`.
- Aggiunta console errori server: audit errori, sync falliti, correzioni utente e problemi di costruzione scheda.

## Debug
- Aggiunto pulsante `Cervello server` dentro `debug.html`.
- Nuova pagina `server-brain.html` per vedere tutti gli articoli salvati, aprire i dettagli e copiare report/errori.

## Vision conferma prodotto
- Corretto invio dati memoria durante `Conferma e aggiungi in casa`.
- Il payload ora include barcode, correzioni manuali, productMemory, ingredienti, allergeni, tracce, colori, nutrizione e labels quando disponibili.

## Sicurezza/cache
- Pagina cervello noindex/nofollow.
- `robots.txt` blocca anche `/server-brain.html`.
- Cache service worker aggiornata a V28.40.
