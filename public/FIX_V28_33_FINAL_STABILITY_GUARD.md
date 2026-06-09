# FIX V28.33 — Final Stability Guard

Passata finale prima del deploy.

## Obiettivo
Rendere lo scanner più stabile senza cambiare il design.

## Cosa protegge
- Diretta AI: se OpenAI non è attivo, il flusso non viene mostrato come bloccato.
- Scatta foto / Carica foto: watchdog anti-blocco se l’analisi resta appesa.
- Follow-up etichetta/scadenza/barcode: se uno step fallisce, la scheda resta recuperabile.
- Lock live: reset sicuro di `liveScanBusy`, cooldown e anteprime di analisi.
- Badge: OpenAI non attivo diventa server-first/local-first, senza spaventare l’utente.

## Regola
Server/memoria/cache/regole prima; OpenAI solo se disponibile e necessario. Se non risponde, l’utente deve sempre poter correggere o rifare, mai restare bloccato.
