# FIX V27.98 - Preflight Stability Check

Obiettivo: prima del test reale, rendere visibili e verificabili i punti critici senza cambiare il flusso principale.

## Incluso
- Pannello preflight dentro scanner: docente OpenAI, memoria server, coda sync, brain attivo.
- Endpoint server `/api/ai/preflight` e `/api/ai/diagnostics`.
- Diagnosi AI nascosta: ultimi eventi, ultima categoria, ultimo sync, ultima preflight.
- Fix runtime per coda sync: nessun ReferenceError dentro flushLearningQueue.
- Sync queue con motivi leggibili: offline, server non raggiunto, impostazioni cloud mancanti, endpoint non confermato.
- Log anti-contaminazione e categoria per debug test.
- Campi scheda sbloccati prima della conferma: nome, marca, formato, categoria, quantità, scadenza.
- Versione visibile: V27.98 Preflight Stability Check.

## Regola
Questa versione non cambia il cuore V27.97: aggiunge strumenti per sapere subito se docente, server, memoria e sync stanno funzionando davvero.
