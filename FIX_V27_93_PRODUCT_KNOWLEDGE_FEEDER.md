# FIX V27.93 — Product Knowledge Feeder

## Obiettivo
Alimentare la memoria prodotto del server con conoscenza esterna verificabile, senza mostrare troppi dati all'utente e senza rallentare la scansione.

## Cosa fa
- Dopo **Conferma e aggiungi in casa**, il server prova ad arricchire il prodotto confermato.
- Usa fonti Open Facts in base alla categoria:
  - Open Food Facts per alimentari/bevande.
  - Open Pet Food Facts per cibo animali.
  - Open Beauty Facts per igiene/persona.
  - Open Products Facts per prodotti casa/altro.
- Salva internamente ingredienti, allergeni, tracce, nutrizione, categoria, fonte e confidenza.
- Non sovrascrive nome, marca o formato già confermati dall'utente.
- Se la categoria è generica, può migliorarla usando i dati esterni.
- Se la fonte non risponde, la conferma prodotto resta valida e il server salva comunque la memoria.

## UI
- Se l'arricchimento va a buon fine: `Memoria server aggiornata + info prodotto arricchite ✅`
- Se non trova dati affidabili: resta `Memoria server aggiornata ✅`

## Endpoint aggiunto
- `POST /api/ai/product-knowledge/lookup`

## Note
Il feeder è best-effort: non blocca il salvataggio prodotto e non deve sostituire la conferma utente.
