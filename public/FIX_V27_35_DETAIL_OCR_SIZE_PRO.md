# V27.35 - Detail OCR + Size Pro

Obiettivo: ridurre errori su capienza/scadenza e bloccare nomi casuali dal microfono.

Migliorie:
- doppia chiamata Vision: riconoscimento prodotto + OCR mirato su etichetta/scadenza/capienza;
- parsing server-side di formati come 500 ml, 1 L, 1,5 L, 2 L, 2000 ml;
- se la capienza non è certa, la AI chiede conferma invece di inventare;
- nuovo campo visibile "Formato / capienza" nella scheda scanner;
- correzione vocale del formato: "due litri", "un litro e mezzo", "500 ml";
- parsing scadenza più robusto con expiryDetectedRaw/expiryConfidence;
- blocco nomi spazzatura tipo "sto", "ok", "manual live";
- memoria aggiornata anche con marca e formato confermato.

Nota realistica: nessun sistema può garantire errore sotto il 5% in ogni luce/angolo/etichetta; questa versione forza conferma vocale se capienza o scadenza non sono lette con sicurezza.
