# Spesa Pronta Final

Versione funzionante del concept mostrato nel mockup.

## Incluso
- Interfaccia responsive stile tablet/mobile con sidebar e pagine:
  - Dashboard
  - Prodotti
  - Lista della spesa
  - Suggerimenti intelligenti
  - Impostazioni & Cloud
  - Registrazione opzionale
- Lingue: Italiano, English, Español, Deutsch
- Quantità con pulsanti - / +
- Unità modificabili
- Algoritmo consumi intelligente basato su:
  - numero persone in casa
  - numero animali
  - soglie dinamiche
  - uso frequente
- Cloud sync reale tramite backend Node/Express
- Endpoint Alexa collegato allo stesso database cloud
- Comandi Alexa supportati:
  - leggere lista spesa
  - aggiungere articolo
  - modificare quantità/unità
  - segnare spesa fatta

## Test frontend
Apri la cartella e lancia:

```bash
python -m http.server 8080
```

Poi apri:

```text
http://localhost:8080
```

## Test backend cloud
In un altro terminale:

```bash
cd backend-example
npm install
npm start
```

Poi nell'app usa:

```text
http://localhost:3000/api
```

## Test dal cellulare
Per testarlo dal cellulare devi pubblicare la cartella frontend su un hosting HTTPS tipo Netlify/Vercel/GitHub Pages.  
Il backend va pubblicato su Render/Railway/Fly.io o un server Node HTTPS. Dopo la pubblicazione inserisci l'endpoint API nelle impostazioni dell'app.

## Alexa
La Skill Alexa deve usare:

```text
POST https://tuo-backend/api/alexa?householdId=ID_FAMIGLIA
```

La lista che Alexa legge è la stessa lista cloud aggiornata dall'app.

## V8 - Spesa Pronta AI Conversazionale
- Assistente chat integrato nell'app: pulsante **Hey Spesa Pronta**.
- Comandi testuali e vocali:
  - "hey spesa pronta, cosa devo comprare"
  - "aggiungi acqua"
  - "segna crocchette cane a 10 kg"
  - "siamo 3 persone"
  - "ho 2 cani"
  - "spiegami perché consigli acqua"
- Wake word opzionale: l'utente può attivare l'ascolto continuo dal pannello AI.
- Apprendimento locale:
  - registra consumi quando le quantità scendono;
  - registra rifornimenti quando le quantità salgono o viene premuto "Ho fatto la spesa";
  - adatta soglie e quantità consigliate usando storico, persone e animali.
- Backend AI:
  - endpoint `POST /api/ai/chat`.
  - Se `OPENAI_API_KEY` è presente sul server, usa OpenAI Responses API.
  - Se manca la chiave, usa il motore locale senza esporre segreti nel frontend.

### Variabili opzionali backend
```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

## V9 - Spesa Pronta AI con memoria + Visione foto

Questa versione aggiunge:

- memoria chat persistente locale (`ai-memory:v2`) con messaggi, preferenze, eventi consumi e storico foto;
- saluto automatico in base all'orario e al profilo utente;
- comandi tipo ChatGPT: "cosa ricordi di me", "dimentica tutto", "fotografa la spesa", "modalità frigo";
- flusso foto dopo il pulsante "Ho fatto la spesa";
- controllo qualità foto: se la foto è troppo scura, sfocata, piccola o poco chiara, l'app chiede di rifarla;
- conferma manuale/modificabile di nome, quantità, unità e categoria;
- se il prodotto esiste già, aggiorna solo quantità/unità;
- se non esiste, crea un nuovo articolo con immagine della foto compressa;
- opzione "Non posso ora: fatta da verificare";
- backend con endpoint `/api/ai/chat`, `/api/ai/vision`, `/api/households/:id/ai-analysis`.

Per attivare una vera AI esterna tipo ChatGPT/Visione, mettere nel backend:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_VISION_MODEL=gpt-4.1-mini
```

La chiave API deve stare solo nel backend, mai nel frontend pubblico.
