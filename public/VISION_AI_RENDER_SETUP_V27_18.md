# V27.18 - Collegare Vision AI reale

Per far riconoscere davvero foto, marca e quantità devi impostare le variabili su Render:

- `OPENAI_API_KEY` = la tua chiave OpenAI
- `OPENAI_MODEL` = `gpt-5.5`
- `OPENAI_VISION_MODEL` = `gpt-5.5`
- `OPENAI_TIMEOUT_MS` = `60000`

Poi fai Manual Deploy su Render e apri `/clear-cache.html`.

La chiave resta solo nel backend: non viene mai messa in `index.html` o `app.js`.

Cosa fa ora la Vision AI:
- legge prodotto, marca, variante/formato;
- stima quantità e unità;
- assegna categoria;
- mostra percentuale di sicurezza;
- se non è sicura chiede conferma;
- non usa più nomi file o numeri casuali.
