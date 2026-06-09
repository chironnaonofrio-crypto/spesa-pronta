# FIX V28.32 — Live + Photo Stability Fix

Questa patch corregge il blocco in Diretta AI e Scatta foto.

## Correzioni
- Lo status OpenAI non blocca più la scansione: la foto passa comunque dal server.
- La chiamata Vision ha timeout controllato, così non resta appesa.
- Se server/OpenAI non completano, viene creata una scheda locale compilabile invece di lasciare la UI bloccata.
- `liveScanBusy` viene sempre sbloccato con `finally`.
- Lo stepper guidato è coerente a 5 fasi: Prodotto, Etichetta, Scadenza, Barcode, Conferma.
- La scheda fallback non mostra più “Docente OpenAI non attivo” come blocco quando la scansione è recuperata localmente.

## Regola
Server/memoria/cache/regole prima. OpenAI è docente finale, non blocco principale.
