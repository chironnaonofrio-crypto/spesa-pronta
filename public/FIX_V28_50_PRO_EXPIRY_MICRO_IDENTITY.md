# V28.50 PRO Expiry + Micro Identity Teacher

- OCR scadenze migliorato per date a puntini/dot-matrix su bottiglie e tappi.
- Parser server robusto per 16/08/20, 16-08-26, 16.08.26, 160826 e varianti OCR.
- Se nome/marca/categoria sono deboli, il server fa una micro-chiamata OpenAI low-token su immagine super compressa per leggere solo identità prodotto.
- La micro-chiamata non legge ingredienti/scadenza e parte solo se memoria/server/local-first non bastano.
- Evita sprechi: API visuali esterne restano disattivate salvo variabili ambiente esplicite.
