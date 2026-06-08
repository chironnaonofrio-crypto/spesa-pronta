# Database, cloud e sincronizzazione

La versione aggiornata include un backend Express funzionante con storage persistente su file JSON (`cloud-db.json`).
Puoi sostituire lo storage con Supabase, PostgreSQL, MySQL o MongoDB mantenendo le stesse rotte API.

## Rotte principali
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/sync?householdId=...`
- `PUT /api/sync`
- `PATCH /api/preferences`
- `PATCH /api/items/:id`
- `POST /api/alexa?householdId=...`

## Sync frontend
Ogni modifica articolo salva in locale e, se cloud è attivo, invia automaticamente lo stato completo al backend.

## Preferenze salvate
- lingua
- numero persone
- numero animali
- spesa intelligente automatica sì/no

## Algoritmo consumi
La soglia non è più fissa: può aumentare in base a persone/animali.
Esempi:
- 2 persone → pochi litri di acqua diventano automaticamente “da comprare”
- 3 animali → 10 kg di crocchette può essere scorta medio/bassa
- se l'utente disattiva l'opzione smart, si usano solo le soglie base dell'articolo
