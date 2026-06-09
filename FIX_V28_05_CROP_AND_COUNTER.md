# FIX V28.05 - Crop immagini + contatore server reale

- Prima di inviare immagini al docente OpenAI, il client ritaglia la zona centrale utile del prodotto/etichetta/scadenza.
- Riduce pixel inutili e peso della richiesta Vision, con log `vision-crop-v2805` in Diagnosi AI.
- Il contatore prodotti server ora usa una vista deduplicata: `count` = prodotti reali unici, `rawCount` = record grezzi, `duplicatesPossible` = possibili duplicati fusi.
- Se un prodotto viene salvato prima senza barcode e poi con barcode, il contatore reale non deve aumentare se nome/marca/formato sono coerenti.
