# FIX V28.38 — OCR Boost Pro

Obiettivo: migliorare lettura OCR per etichetta, ingredienti, scadenza e barcode.

Modifiche:
- teacher image OCR ad alta risoluzione per label/expiry/barcode;
- contrasto/brightness dedicati lato client prima del docente;
- foto piena resta al server, immagine OCR ottimizzata va a OpenAI solo se serve;
- prompt OCR più stretti per etichetta, scadenza e barcode;
- euristiche server per estrarre formato, data, barcode da detectedText/visibleEvidence;
- correzioni mirate per bottiglie acqua e bibite se il testo OCR è leggibile.

Versione: V28.38 OCR Boost Pro.
