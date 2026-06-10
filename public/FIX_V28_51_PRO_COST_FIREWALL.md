# V28.51 PRO Cost Firewall

Obiettivo: riportare il costo Vision a livello basso e impedire doppie chiamate OpenAI inutili.

- Vision model default: modello mini invece del modello pieno, salvo override via env.
- Prompt Vision ridotti: niente cataloghi enormi dentro ogni chiamata.
- Output token cap: product/auto 240 circa, label 260, expiry 120.
- Una sola chiamata OpenAI per scansione: il micro-docente extra viene bloccato di default se il docente principale ha già lavorato.
- Immagini teacher più leggere: product/auto circa 760px q58, label 820px q62, expiry leggibile 940px q70.
- La scadenza resta prioritaria e non deve inventare.

Env utili:

```env
OPENAI_VISION_MODEL=gpt-5.4-mini
VISION_COST_SAVER_MODE=true
VISION_MAX_OUTPUT_TOKENS=240
VISION_EXPIRY_MAX_OUTPUT_TOKENS=120
VISION_LABEL_MAX_OUTPUT_TOKENS=260
VISION_ALLOW_SECOND_OPENAI_PASS=false
```
