# Spesa Pronta - deploy da telefono

Pacchetto all-in-one: frontend + backend nello stesso server.

## Render
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables:
  - `OPENAI_API_KEY` = la tua chiave OpenAI
  - `OPENAI_MODEL` = `gpt-5.5`
  - `OPENAI_VISION_MODEL` = `gpt-5.5`
  - `DB_PATH` = `./cloud-db.json`

Dopo il deploy apri `/api/ai/status`. Se risponde `connected:true`, AI chat e vision sono collegate.

## Dominio
Aggiungi `spesapronta.it` nei Custom Domains del servizio e poi copia i record DNS richiesti nel pannello del registrar.
