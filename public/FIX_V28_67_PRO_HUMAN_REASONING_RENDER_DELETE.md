# V28.67 PRO Human Reasoning Bus + Virtual Render + Owner Delete

Questa versione collega in modo più pulito i motori VisionAI, pixel judge, OCR, memoria server, Open Facts/barcode e valori titolare.

## Nuovo ragionamento umano server
- ogni scheda memoria espone `humanReasoningV2867`
- distingue identità prodotto, aspetto, contenuto, rischio e regole decisionali
- colore/forma restano indizi, non identità
- memoria vecchia non deve vincere su OCR/barcode/foto attuale in conflitto

## Render virtuale articolo
- ogni prodotto può generare `virtualRenderV2867`
- il render mostra forma, colori, etichetta, contenuto e formato ricostruiti dalla memoria
- nuovo tab `Render AI` nel Cervello Server
- endpoint: `/api/ai/server-brain/render`

## Eliminazione articolo dal Cervello Server
- nuovo pulsante “Elimina articolo dal cervello” nella tab Modifica
- richiede conferma testuale `ELIMINA`
- endpoint: `/api/ai/server-brain/delete`
- se `SERVER_BRAIN_OWNER_TOKEN` è impostato, serve token titolare

## OCR.space router migliorato
- invio OCR.space su crop multipli più intelligenti
- crop etichetta principale, etichetta larga, parte alta/bassa, centro prodotto
- versioni ad alto contrasto/colore/soglia
- scelta del testo migliore per qualità, non per lunghezza
- variabile opzionale: `OCR_SPACE_MAX_CROPS=4`

## Bridge dati
- `buildServerProductMemoryV2840` riceve `reasoningBusV2867`
- `serverPixelOcrJudgeV2864` viene sanificato dal bus umano V28.67
- le card pubbliche del Cervello Server allegano render e ragionamento
