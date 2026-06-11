# V30 Reference Render Engine

- Il server non prova più a fingere un render con card/CSS/crop sporchi.
- Nuovo flusso: cerca reference reali online/API, importa URL titolare, rimuove sfondo localmente, salva render ufficiale in cartella oggetto.
- Nuovi endpoint:
  - GET/POST `/api/render-reference/search`
  - POST `/api/render-reference/import`
  - GET/POST `/api/render-reference/generate`
  - GET/POST `/api/render-reference/360`
- Compatibile anche con endpoint legacy:
  - `/api/ai/server-brain/reference-render`
  - `/api/ai/server-brain/import-reference`
- Fonti gratuite: Open Food Facts / Open Products Facts / Open Beauty Facts.
- Fonti opzionali configurabili: Google CSE, SerpAPI, Bing Image Search.
- UI Cervello Server aggiornata a V30.0.
