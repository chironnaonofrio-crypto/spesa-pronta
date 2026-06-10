# V28.39 OpenAI max_output_tokens fix

Fix reale dell'errore OpenAI visto in Diagnosi AI:

`Invalid max_output_tokens: integer below minimum value. Expected a value >= 16, but got 8 instead.`

## Correzioni

- Health check OpenAI aggiornato da `max_output_tokens: 8` a `max_output_tokens: 16`.
- Guardia globale in `openAiResponse`: qualsiasi chiamata con `max_output_tokens < 16` viene alzata automaticamente a 16.
- Versione Diagnosi aggiornata a V28.39.
- Service worker/cache bump.

Questa patch non cambia la UX scanner: corregge solo la chiamata OpenAI che falliva con 400.
