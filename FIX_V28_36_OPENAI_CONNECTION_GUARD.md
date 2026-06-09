# V28.36 - OpenAI Connection Guard

Obiettivo: rendere chiaro e robusto il collegamento OpenAI lato server.

## Problema
Il frontend mostrava "Docente OpenAI non attivo" senza distinguere bene tra:
- chiave mancante sul server
- chiave placeholder
- chiave non valida
- modello non disponibile
- timeout/rete
- quota/billing/rate limit

## Fix
- La chiave OpenAI viene letta solo lato server.
- Variabile principale: `OPENAI_API_KEY`.
- Alias accettati per evitare errori di configurazione hosting:
  - `OPENAI_API_KEY`
  - `OPENAI_KEY`
  - `OPENAI_SECRET_KEY`
  - `OPENAI_TOKEN`
- La chiave viene sempre mascherata in diagnostica.
- Aggiunto endpoint:
  - `GET /api/ai/openai-check`
  - `GET /ai/openai-check`
- Il check fa una chiamata reale minima alla Responses API e restituisce stato chiaro.
- Aggiunti fallback modello:
  - `OPENAI_MODEL`
  - `OPENAI_VISION_MODEL`
  - `OPENAI_MODEL_FALLBACKS`
- La Vision ora salva errori OpenAI classificati in `cloudError` e `openAiDiagnostics`.

## Nota importante
Il pacchetto non può contenere la chiave OpenAI. Su Render/Railway/VPS va impostata come Environment Variable:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5
OPENAI_VISION_MODEL=gpt-5.5
OPENAI_MODEL_FALLBACKS=gpt-5.5,gpt-5.4-mini,gpt-5.4-nano
```

Dopo averla impostata bisogna fare redeploy/restart del server.
