# V28.63 PRO True Product Vision OCR Shield

Patch strutturale per evitare falsi match memoria quando la foto attuale mostra un prodotto diverso.

- aggiunto controllo famiglia foto attuale: acqua/cola/tè/succhi/latte/casa/salse
- aggiunto OCR gratuito browser opzionale su crop etichetta: TextDetector se disponibile, Tesseract.js lazy da CDN come fallback, zero token OpenAI
- memoria visiva server accettata solo se coerente con foto attuale o con similarità molto alta
- bloccato bug strutturale: bottiglia + liquido non diventa automaticamente acqua
- se foto attuale indica Sant'Anna/acqua, una memoria Cola viene respinta
- se foto attuale indica Cola scura, una memoria acqua viene respinta
- il server salva evidenze OCR/ancore visuali confermate nella cartella oggetto
- cost policy: memoria/ocr/conflitto = 0 token OpenAI
