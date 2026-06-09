# V28.17 Remove Verify + Footer Flow

Base: V28.10 UI Pill Cleanup.

Modifiche chirurgiche:
- Rimossa la pillola “Fatta da verificare” dallo scanner.
- Rimosso il listener JS `markVerifyBtn`.
- Aggiornato il testo vocale per non suggerire più la verifica rimandata.
- Reso `scanner-footer` non sticky: “Completa controllo” e “Svuota risultati” restano in fondo al contenuto del menu, non bloccati davanti allo schermo.
- Aggiunto override CSS su root/public per prevenire vecchie regole sticky in cache.
