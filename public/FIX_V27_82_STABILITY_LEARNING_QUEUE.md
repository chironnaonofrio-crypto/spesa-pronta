# V27.82 Stability + Learning Queue

- ID sessione univoco per ogni nuova scansione prodotto.
- Risultati vecchi/stale ignorati se arrivano dopo una nuova scansione.
- Follow-up etichetta/scadenza vincolato alla stessa scheda.
- Pulsante “Rifai scadenza” per correggere solo la terza foto.
- Coda locale di apprendimento: se Supabase/server non risponde, la conferma viene salvata e sincronizzata appena torna online.
- Badge semplice: memoria server aggiornata / in attesa sync.
- Parser scadenze rinforzato per 09/2025, 09-25, SCAD. 09/2025, errori OCR O/0 e I/1.
