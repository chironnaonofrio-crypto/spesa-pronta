# Spesa Pronta - sicurezza, email e recupero password

## Dati database
La V16 salva il documento principale dentro Supabase/Postgres cifrato con AES-256-GCM.
La chiave deriva da `APP_SECRET` nelle variabili Render. Se non imposti `APP_SECRET`, usa una derivazione di emergenza da `DATABASE_URL`, ma per produzione devi impostare `APP_SECRET`.

## Password utenti
Le password non vengono salvate in chiaro: sono salvate con PBKDF2 + salt. Gli account vecchi SHA-256 vengono migrati al primo login.

## Recupero password
Endpoint disponibili:
- `POST /api/auth/forgot` con `{ "email": "utente@email.it" }`
- `POST /api/auth/reset` con `{ "token": "...", "password": "nuovaPassword" }`

La risposta di `forgot` è sempre generica, così non rivela se una email è registrata.

## Email
La V16 invia email di benvenuto e recupero password tramite Resend se imposti:
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `APP_BASE_URL=https://spesa-pronta.it`

Senza `RESEND_API_KEY`, il server non può spedire email reali: scrive solo un log simulato.
