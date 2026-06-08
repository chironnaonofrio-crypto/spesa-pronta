# V28.01 Sync Hash Fix

Fix mirato per sync server /api/ai/learn/autonomy.

- Corretto crash server causato da helper hash non definito nel salvataggio memoria globale per householdHash.
- Aggiunto hashStable() server-side.
- Endpoint learn/autonomy ora restituisce errori specifici (learn_autonomy_failed + reason) invece di generico server_error.
- Risposta sync positiva ora include saved:true e syncConfirmed:true.
- Aggiornata diagnostica build a V28.01.
