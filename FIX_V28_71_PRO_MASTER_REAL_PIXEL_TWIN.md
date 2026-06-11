# V28.71 PRO MASTER Real Pixel Twin

Patch per rendere il gemello visivo del Cervello Server molto più realistico e mobile-safe.

## Migliorie

- Render AI passa a **REAL PIXEL TWIN**.
- Il render non è solo disegno: quando esiste una foto reale o una reference Open Facts/API, il frontend usa quei pixel come texture dentro una sagoma semantica.
- Server genera `virtualRenderV2871` e `humanReasoningV2871`.
- Specifica render include `renderMode`, `referencePhotoAvailable`, `referencePhotoKind`, `detailScore` e qualità realistica.
- Pagina Cervello Server mostra due livelli:
  - **Gemello foto-reale**: pixel reali salvati/API.
  - **Gemello semantico server**: SVG del server con forma, colori, etichetta e contenuto.
- Layout Render AI reso mobile-first: niente più pannello enorme orizzontale, niente immagine fuori schermo, niente box bianco gigante.
- Pulsanti sfondo bianco/trasparente continuano a rigenerare il render lato server.

## Regola

Il render deve far capire cosa il server ha capito del prodotto. Se il gemello foto-reale o semantico non torna, il titolare corregge foto/valori e quei dati vincono.
