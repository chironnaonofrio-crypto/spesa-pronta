# V28.03 Low Cost + Category Accuracy

Obiettivo: ridurre costo scansioni e migliorare categorie.

- Immagini compresse più aggressive prima dell’invio al backend.
- Foto prodotto live/photo ridotte a circa 720/760 px.
- Vision OpenAI non fa più doppia chiamata sullo step etichetta: usa un singolo prompt OCR compatto.
- Step scadenza usa prompt dedicato corto e token ridotti.
- Stage auto usa una sola analisi compatta, non doppio passaggio.
- Max output token ridotto per stage: prodotto, etichetta, scadenza.
- Nuovo motore categoria V28.03 client/server con regole più forti su cola, acqua, latte, yogurt, salse, detersivi, igiene, animali, acquario.
- La confezione è solo indizio; testo etichetta/nome/marca vincono.
- Anti-conflitto: cola non può diventare acqua, salsa/pesto non può diventare bevanda, detersivo non può diventare alimento.
