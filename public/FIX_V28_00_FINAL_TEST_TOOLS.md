# V28.00 Final Test Tools

Patch di test finale prima del deploy reale.

## Aggiunto
- Pulsante Test Sync ora in Diagnosi AI.
- Pulsante Copia diagnosi con report compatto.
- Contatore prodotti server nel pannello preflight.
- Endpoint POST /api/ai/test-sync per verificare auth + database senza creare prodotti finti.
- Versione build V28.00 e cache service worker aggiornata.
- Diagnostica più leggibile: docente, DB, queue, ultimo sync, categoria, eventi recenti.

## Obiettivo
Capire subito se il problema è client, endpoint, rete, auth, Supabase o coda sync.
