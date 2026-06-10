# V28.64 PRO Human-Like Pixel OCR Reasoning Engine

Patch strutturale Vision:

- analisi pixel server con `sharp` per forma, dimensioni/proporzioni, colori dominanti, zona etichetta, contenuto visibile, liquido chiaro/scuro, prodotto lungo/flacone/scatola;
- OCR multi-crop gratuito lato browser con TextDetector/Tesseract.js quando disponibile;
- endpoint `/api/ai/pixel-ocr-judge` per far giudicare al server foto + pixel + OCR prima di OpenAI;
- adattatore OCR.space opzionale/free-key (`OCR_SPACE_ENABLED=true`, `OCR_SPACE_API_KEY=...`);
- adattatore Google Vision OCR opzionale e disattivo di default (`GOOGLE_VISION_OCR_ENABLED=true`, `GOOGLE_VISION_API_KEY=...`);
- compilazione campi da testo reale: nome, marca, formato, categoria, tipo prodotto;
- memoria vecchia non può vincere contro OCR/pixel della foto attuale;
- OpenAI resta ultimo docente e viene saltato quando pixel+OCR sono sufficienti.

Variabili consigliate:

```env
OCR_SPACE_ENABLED=true
OCR_SPACE_API_KEY=la_tua_chiave_free
OCR_SPACE_LANGUAGE=ita
GOOGLE_VISION_OCR_ENABLED=false
VISION_PAID_APIS_ENABLED=false
```
