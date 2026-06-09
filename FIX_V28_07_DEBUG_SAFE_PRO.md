# FIX V28.07 - Debug Safe Pro

Miglioramenti finali prima upload:

- debug.html con meta noindex/nofollow/noarchive/nosnippet.
- report diagnostici sanitizzati: token, bearer, api key e DATABASE_URL vengono oscurati.
- copia diagnosi breve e completa separate.
- copia coda sicura senza payload pesante/sensibile.
- stato cache/build più chiaro.
- console pronta per password futura: debug lock predisposto, password non ancora attiva.
- errori sync tradotti in testo leggibile.
- reset eventi diagnosi locale.
- retry sync mantiene motivi reali di errore nel job.

Non cambia il cuore scanner/AI: patch di sicurezza, pulizia e test.
