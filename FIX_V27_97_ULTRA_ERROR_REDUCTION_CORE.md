# V27.97 Ultra Error Reduction Core

Aggiornamento PRO per abbassare la soglia di errore della Vision AI.

## Blocchi implementati

- Categoria multi-score con candidati e motivazioni.
- Priorità reale: etichetta corrente > barcode > correzione utente > memoria server > web/docente > forma confezione.
- Stato fisico prodotto: liquido da bere, liquido alimentare, cremoso, solido, polvere, surgelato, prodotto casa, igiene, farmacia, animali, acquario.
- Packaging e materiale come indizi non autoritari.
- Barcode/EAN come prova forte anti-contaminazione.
- Parser formato rafforzato per multi-pack e unità reali.
- Parser scadenza dedicato con correzione OCR.
- Separazione ingredienti, allergeni certi e possibili tracce.
- Confidenza per campo: nome, marca, categoria, formato, scadenza, barcode, ingredienti, allergeni.
- Memoria server con anti-fusione e rigetto match incoerenti.
- Correzioni utente trasformate in apprendimento forte.
- Endpoint `/api/ai/ultra-brain`.
- Status aggiornato con `ultraBrainV97`.

## Regola fondamentale

La forma della confezione non decide mai da sola la categoria. Bottiglia, vasetto, flacone, barattolo e busta sono solo indizi.

## Obiettivo

Ridurre errori tipo: cola -> acqua, pesto -> conserva generica, yogurt/kefir -> latte, detersivo -> alimentare, salsa BBQ -> pesto.
