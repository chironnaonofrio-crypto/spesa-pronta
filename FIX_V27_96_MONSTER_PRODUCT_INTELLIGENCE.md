# V27.96 Monster Product Intelligence

Questa versione applica il blocco “Monster Product Intelligence”: categoria a punteggio, stato fisico, packaging, materiale confezione, barcode/EAN, anti-errori ricorrenti, ingredienti/allergeni interni, campo-per-campo confidence, sync server e memoria globale più prudente.

Principi:
- etichetta attuale > barcode > conferma utente > memoria server > web/cache > docente OpenAI;
- packaging/confezione è indizio, non categoria;
- se il prodotto è incerto non inventa: chiede etichetta o conferma;
- non salva foto pesanti: salva firma visiva, testo, token, barcode, ingredienti, allergeni e correzioni.

Implementati i 50 miglioramenti richiesti in forma operativa: categorie espanse, anti contaminazione, scadenza dedicata già presente, learning queue, barcode brain, cache conoscenza, memoria errori ricorrenti, affidabilità per campo, debug `/api/ai/monster-brain`, e regole più severe per cola/acqua/pesto/salsa/yogurt/detersivi/pet/acquario.
