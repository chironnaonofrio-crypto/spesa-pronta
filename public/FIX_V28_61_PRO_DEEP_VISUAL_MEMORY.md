# V28.61 PRO Deep Visual Memory Match

- Migliorato il match visivo gratuito prima di OpenAI.
- La foto nuova viene trasformata in impronta visiva profonda: ROI prodotto, bbox, silhouette, hash percettivi, label crop, istogrammi colore e stripe signature.
- Il server confronta la foto con le impronte salvate nelle cartelle oggetto.
- Se il match è alto, precompila prodotto, marca, formato e categoria senza token OpenAI.
- OpenAI resta solo dopo memoria/barcode/API se il match non è sufficiente.
- Le vecchie conferme restano usabili, ma le nuove conferme da V28.61 salvano impronte più forti.
