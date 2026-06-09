# FIX V28.34 - Preflight Bug Sweep

Passata finale prima del caricamento.

Correzioni:
- corretti caratteri di controllo accidentali nei regex word-boundary `\b` che potevano impedire il riconoscimento del soggetto centrale, specialmente Coca-Cola/cola/prodotti idonei;
- aggiornati cache name e query asset a V28.34;
- aggiunto marker diagnostico `preflight-bug-sweep-v2834-ready`;
- verificati file realmente caricati da index: `assets/app.v27-48-premium-mega-vision.js`;
- mantenuti attivi: bozza scansione, 5 step con barcode, watchdog anti-blocco, server-first/local-first.

Nota: senza ambiente deploy e credenziali reali non è possibile garantire la risposta runtime di OpenAI/Supabase, ma il pacchetto è stato controllato staticamente e con `node --check`.
