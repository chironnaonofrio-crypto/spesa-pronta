# V27.94 Smart Knowledge Cache + Barcode Brain

- Aggiunto Barcode/EAN Brain: se il codice viene letto da OCR/AI viene salvato nella memoria globale server.
- Il match globale usa prima il barcode quando presente.
- Product Knowledge Feeder ora usa cache persistente server per evitare ricerche ripetute inutili.
- Se il barcode è disponibile, prova lookup diretto sulle fonti Open Facts prima della ricerca testuale.
- Le correzioni utente su nome, marca, formato, categoria, scadenza e quantità vengono salvate come apprendimento forte anti-errori ricorrenti.
- Payload di apprendimento alleggerito: niente immagini pesanti, solo dati prodotto, testo, firma/feature e memoria interna.
- /api/ai/status ora espone knowledgeCache, barcodeBrain ed errorLearning per audit tecnico.
- Cache app aggiornata a V27.94.
