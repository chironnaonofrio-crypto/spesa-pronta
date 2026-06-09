# V28.16 Remove Verify + Modal Safe

Base: V28.11 funzionante.

Modifiche chirurgiche:
- Rimossa pillola/pulsante “Fatta da verificare”.
- Rimosso listener `markVerifyBtn`.
- Aggiornato testo vocale: non propone più “fatta da verificare”.
- Aggiunta protezione CSS forte: `#groceryScannerDialog:not([open])` è nascosto anche su browser senza supporto dialog nativo.
- Aggiunta posizione fixed quando il dialog è aperto, così non viene renderizzato dentro la home.

Non toccati AI/server/flusso scansione.
