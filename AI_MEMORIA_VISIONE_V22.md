# Spesa Pronta V22 - AI vocale, visione e memoria progressiva

## Cosa aggiunge

### 1. Memoria personale per ogni utente/casa
Ogni household ha una memoria AI persistente nel database Supabase:

- `messages`: chat con l’assistente
- `facts`: preferenze e informazioni dichiarate dall’utente
- `events`: eventi consumo/rifornimento
- `scanHistory`: foto analizzate e risultati Vision
- `preferences`: preferenze strutturate

Questa memoria viene salvata nel database cifrato lato server insieme al resto dello stato.

### 2. Memoria globale anonima dell’assistente
La memoria globale non conserva dati personali. Salva solo statistiche aggregate anonime, ad esempio:

- frasi più richieste
- prodotti più fotografati
- categorie più comuni
- conteggi giornalieri chat/foto/voce

Serve per rendere l’esperienza sempre più intelligente senza esporre le informazioni private dei singoli utenti.

Endpoint controllo:

```txt
GET /api/ai/global-memory
```

### 3. Chat AI persistente
Endpoint:

```txt
POST /api/ai/chat
```

Se invii `householdId` nel body e `Authorization: Bearer <token>`, la chat viene salvata nella memoria dell’utente.

### 4. Vision AI reale
Endpoint:

```txt
POST /api/ai/vision
```

Analizza solo ciò che vede realmente. Se la foto è scura, sfocata, tagliata o non permette di stimare quantità/prodotto, restituisce `needsRetake: true`.

### 5. Alexa e Google Assistant più intelligenti
Gli endpoint vocali usano la stessa memoria e lo stesso database:

```txt
POST /api/alexa?householdId=...&token=...
POST /api/google-assistant?householdId=...&token=...
```

Se l’intento non è una semplice azione lista/quantità, il backend risponde come assistente AI conversazionale.

## Variabili Render necessarie

```txt
DATABASE_URL=...
APP_SECRET=...
APP_BASE_URL=https://spesa-pronta.it
EMAIL_FROM=Spesa Pronta <noreply@spesa-pronta.it>
RESEND_API_KEY=re_...
OPENAI_API_KEY=sk-...   # necessaria per AI Chat/Vision vera
OPENAI_MODEL=gpt-5.5
OPENAI_VISION_MODEL=gpt-5.5
```

Senza `OPENAI_API_KEY`, l’app usa fallback locale e inserimento guidato foto. Con la chiave, Chat e Vision sono reali dal backend.
