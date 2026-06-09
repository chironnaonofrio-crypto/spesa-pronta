# V28.02 Barcode Merge Dedupe

Fix: se un prodotto viene salvato prima senza barcode e poi viene riconosciuto con barcode/EAN, il server non crea un nuovo prodotto globale.

## Regola
- Barcode/EAN è una prova forte, ma se esiste già una scheda globale compatibile senza barcode, quella scheda viene aggiornata e migrata a chiave `ean:<barcode>`.
- Il contatore prodotti server non aumenta per lo stesso articolo.
- Aumenta solo il numero conferme e vengono aggiunti barcode/evidenze.

## Anti-contaminazione
La fusione avviene solo se non ci sono conflitti forti di marca/categoria/token e se il punteggio di similarità è sufficiente.
