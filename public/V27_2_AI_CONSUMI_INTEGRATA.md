# Spesa Pronta V27.2 — AI consumi integrata

Questa versione è pronta da ricaricare su GitHub/Render senza copiare patch manuali.

## Cosa è stato integrato

- Profilo utente più coerente: nome, cognome, username, email, persone in casa e animali.
- Pulsante utente in alto: mostra “Registrati / Login” se non c’è un profilo, oppure il nome dell’utente se esiste.
- Motore AI consumi dentro `assets/app.js` e `public/assets/app.js`.
- Calcolo scorte basato su:
  - numero persone;
  - numero animali;
  - categoria prodotto;
  - soglie minime;
  - consumo giornaliero stimato;
  - storico reale degli eventi quando l’utente diminuisce quantità o mette prodotti in lista.
- Pannello “AI CONSUMI V27” nella sezione Suggerimenti.
- Schede suggerimento con giorni rimasti, soglia, quantità consigliata e motivo del consiglio.
- Backend aggiornato con endpoint `/api/households/:id/ai-analysis` più completo.
- Cache service worker aggiornata per evitare che il telefono continui a vedere la versione vecchia.

## File sincronizzati

Sono allineati sia i file root sia quelli in `public/`:

- `index.html`
- `assets/app.js`
- `assets/styles.css`
- `service-worker.js`
- `public/index.html`
- `public/assets/app.js`
- `public/assets/styles.css`
- `public/service-worker.js`

## Deploy

Carica lo ZIP su GitHub/Render come al solito. Non serve incollare codice manualmente.

Dopo il deploy, su telefono apri il sito e fai un refresh completo. La cache nuova è `spesa-pronta-v27-2-ai-consumi`.
