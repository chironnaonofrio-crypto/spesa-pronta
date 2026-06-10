# V28.65 PRO OCR Quality Gate + True Visual Judge

Questa patch evita che OCR spazzatura venga usato per compilare nome, marca o scadenza.

## Fix principali

- OCR.space usa crop compressi e mirati su etichetta/oggetto, non la foto intera come prima scelta.
- Il testo OCR non viene scelto per lunghezza, ma per qualità: parole reali, brand, categoria, formato, pochi simboli strani.
- Testi tipo `R SAS a A`, simboli casuali e stringhe con `=>`, `_`, `<` vengono scartati.
- `Famiglia visiva attuale: cola` non può diventare nome prodotto.
- `01/01/2000` e date vecchie generate da OCR rumore vengono rifiutate.
- La guida live non continua più a dire “allontanati” per bottiglie lunghe: chiede di centrare etichetta e togliere riflessi.

## Politica costi

- OpenAI non viene usato da questa patch.
- OCR.space resta gratuito/esterno se configurato.
- Se OCR non è affidabile, il sistema non inventa: chiede barcode o etichetta migliore.
