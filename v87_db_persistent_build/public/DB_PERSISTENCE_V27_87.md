# V27.87 - Database persistente

Il profilo NON deve sparire al logout.

## Regola
- Logout = rimuove solo il token/sessione dal dispositivo.
- Profilo, lista, household e AI memory restano nel database.
- Elimina account = cancella solo se l'utente conferma esplicitamente `ELIMINA`.

## Importante su Render
Se il database è salvato in `.data/cloud-db.json`, può sparire a ogni deploy/restart perché il filesystem è temporaneo.
Per renderlo persistente serve un disco persistente montato su:

```txt
/var/data
```

Questa build include `render.yaml` con:

```yaml
disk:
  name: spesa-pronta-data
  mountPath: /var/data
  sizeGB: 1
envVars:
  - key: DATA_DIR
    value: /var/data
```

## Verifica
Apri:

```txt
https://TUO-DOMINIO/api/health
```

Devi vedere:

```json
"db": {
  "persistent": true,
  "dataDir": "/var/data"
}
```

Se `persistent` è false o `dataDir` è `.data`, al prossimo deploy puoi perdere gli account.

## Backup manuale
Con token valido puoi aprire:

```txt
/api/export-db
```

usando Authorization Bearer token.
