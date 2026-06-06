# Spesa Pronta V13 - Database Supabase collegato

Questa versione usa `DATABASE_URL` quando presente nelle Environment Variables del server.

## Come funziona
- Senza `DATABASE_URL`: salva in `cloud-db.json` locale, utile solo per test.
- Con `DATABASE_URL`: salva su Supabase/Postgres in cloud.

## Tabella creata automaticamente
Al primo avvio il server crea automaticamente:

```sql
CREATE TABLE IF NOT EXISTS spesa_pronta_store (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Dentro `data` vengono salvati utenti, case, prodotti, chat AI, memoria, inventario iniziale e impostazioni.

## Controllo rapido
Apri:

```txt
/api/db/status
```

Se risponde:

```json
{"connected":true,"mode":"supabase-postgres"}
```

il database cloud è collegato.
