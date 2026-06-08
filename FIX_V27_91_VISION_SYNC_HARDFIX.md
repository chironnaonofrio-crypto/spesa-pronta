# V27.91 Vision Sync Hard Fix

Correzioni principali:

- Fix regex categoria: rimossi caratteri di controllo nascosti e ripristinati i veri word-boundary `\b`.
- Cola / Blues / bibite gassate: regole più forti per evitare classificazione errata come acqua.
- Nome e marca della scheda scanner restano modificabili dall'utente e non vengono più riscritti dall'OCR/memoria dopo modifica manuale.
- Sincronizzazione memoria server alleggerita: invia payload compatto invece dell'intera memoria locale, evitando errori/payload troppo pesanti.
- Messaggio sync più chiaro se il server non risponde: sync in coda invece di errore tecnico.
- Cache aggiornata a V27.91.

Nota: se appare ancora sync in coda, controllare endpoint `/api/ai/status` e token famiglia. La coda ritenta automaticamente.
