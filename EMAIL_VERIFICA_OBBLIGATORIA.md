# Verifica email obbligatoria - Spesa Pronta V19

Da questa versione un nuovo utente non entra nella dashboard subito dopo la registrazione.

Flusso corretto:

1. L'utente compila registrazione.
2. Il server controlla il formato dell'email.
3. Il server crea l'utente con `emailVerified: false`.
4. Il server genera un token casuale, salva solo l'hash SHA-256 del token e manda il link via email.
5. L'utente apre il link `https://spesa-pronta.it?verify=TOKEN` oppure incolla il token nella pagina di verifica.
6. Solo dopo la verifica vengono restituiti token cloud, household e accesso alla dashboard.
7. Dopo la verifica parte email di benvenuto e inventario iniziale obbligatorio.

Endpoint aggiunti:

- `POST /api/auth/verify-email`
- `POST /api/auth/resend-verification`

Login:

- Se l'email non è verificata, il login risponde `403 email_not_verified` e l'app porta alla pagina di verifica.

Note sicurezza:

- Nel database non viene salvato il token in chiaro, ma solo il suo hash.
- Il token di verifica scade dopo 24 ore.
- Il recupero password rimane generico: non rivela se una email è presente o assente.
