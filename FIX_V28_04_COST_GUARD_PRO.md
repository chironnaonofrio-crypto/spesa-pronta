# V28.04 Cost Guard Pro

Obiettivo: ridurre drasticamente costo scansioni e chiamate docente OpenAI senza perdere il flusso.

## Implementato
- Compressione immagini più aggressiva lato client.
- Cache docente per evitare doppie richieste uguali.
- Budget docente per sessione articolo: 1 analisi completa + 1 OCR scadenza ultra leggero se indispensabile.
- Prompt server tagliati: rimossi cataloghi/memorie enormi dalle richieste Vision.
- Token max ridotti per prodotto, etichetta, scadenza.
- Diagnostica cost guard con eventi `cost-guard-*`.
- Stato server `costGuardV2804` esposto nello status.

## Regola
Locale, memoria server, barcode e cache vengono prima. OpenAI resta docente raro, non uno scanner per ogni foto.
