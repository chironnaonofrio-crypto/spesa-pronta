# FIX V28.49 PRO ChatGPT-Level Vision Judge

Questa versione rafforza la Vision in modo strutturale, non prodotto per prodotto.

## Regole principali

- Identita' prodotto separata da ingredienti/allergeni/tracce.
- Se un prodotto ha solo "tracce di latte", non diventa latte.
- Se un prodotto ha solo colore verde, non diventa verdura.
- Se un prodotto e' una bottiglia, non diventa cola/acqua/tè senza testo reale.
- Nome e categoria si decidono solo con prove forti: OCR/etichetta, barcode, memoria titolare, API prodotto affidabili, docente OpenAI quando serve.
- Se il locale non ha prove, non inventa: forza docente/controllo manuale.

## Cervello generale ampliato

Aggiunta ontologia PRO piu' ampia per:

- pulizia casa
- bucato
- lavastoviglie/piatti
- carta casa
- bevande acqua/succhi/tè/gassate/latte
- caffè/tisane
- yogurt/latticini/uova
- pasta/riso/farine/pane/cereali
- dolci/creme/salse/olio/spezie/conserve
- surgelati/carne/pesce/frutta/verdura vera
- igiene personale/orale/farmacia
- animali/acquario

## API e sprechi

- Mantiene Open Facts family multi-source e cache.
- Aggiunti adattatori opzionali per:
  - Home Brain / console a casa
  - endpoint visuale esterno generico
  - Hugging Face Vision opzionale
  - Google Vision opzionale
- Le API visuali esterne sono disattive di default.
- Google Vision parte solo con flag pagato esplicito.
- Le API visuali esterne possono validare famiglia/categoria ampia, ma non possono inventare nome o marca.

## Debug

Ogni risultato Vision ora puo' includere:

- `proVisionJudgeV2849`
- `proVisionClientV2849`
- `proExternalVisualV2849`
- `proVisionV2849`

Questi campi spiegano se il cervello ha corretto qualcosa, se ha bloccato tracce/colori, se serve docente e quali API erano configurate.

## Controlli

- `server.js` controllato con `node --check`
- `assets/app.js` controllato con `node --check`
- `assets/app.v27-48-premium-mega-vision.js` controllato con `node --check`
- cache aggiornata a V28.49
