# Spesa Pronta AI - Collegamento backend vero

Questa versione è già pronta per usare AI Chat + AI Vision dal backend.

## Cosa fa

- `/api/ai/chat`: risponde come assistente personale Spesa Pronta AI.
- `/api/ai/vision`: analizza una foto prodotto e restituisce JSON con nome, quantità, unità, categoria, confidenza e richiesta di rifare la foto se non vede bene.
- `/api/ai/status`: dice se la chiave AI è collegata davvero.
- La memoria chat e le foto vengono sincronizzate nello stato famiglia quando il cloud è attivo.

## Come attivarla in locale

1. Entra nella cartella backend:

```bash
cd backend-example
```

2. Copia il file di esempio:

```bash
cp .env.example .env
```

3. Apri `.env` e sostituisci:

```bash
OPENAI_API_KEY=INSERISCI_LA_TUA_CHIAVE_OPENAI
```

con la tua chiave vera.

4. Avvia il backend:

```bash
npm start
```

5. Controlla lo stato:

```bash
curl http://localhost:3000/api/ai/status
```

Se tutto è corretto vedrai `connected: true` e `visionReady: true`.

## Come attivarla su hosting

Su Render, Railway, Fly.io o simili aggiungi queste Environment Variables nel pannello del server:

```bash
OPENAI_API_KEY=la_tua_chiave
OPENAI_MODEL=gpt-5.5
OPENAI_VISION_MODEL=gpt-5.5
```

Poi imposta nell'app frontend l'API Endpoint del backend, per esempio:

```text
https://tuo-server.onrender.com/api
```

## Sicurezza

La chiave AI deve stare solo nel backend. Non deve essere mai inserita nel frontend pubblico.

## Test foto

Apri l'app, premi `Ho fatto la spesa`, poi `Scatta foto articolo`.

- Se la foto è bella, AI Vision propone nome, quantità, unità e categoria.
- Se non vede bene, chiede di rifarla.
- Se il prodotto è già presente, aggiorna la quantità.
- Se è nuovo, crea l'articolo con nome modificabile.
