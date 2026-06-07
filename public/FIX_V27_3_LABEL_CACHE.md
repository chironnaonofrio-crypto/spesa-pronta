# Fix V27.3 - Etichette registrazione e cache

Correzioni applicate dopo screenshot mobile:

- Rimosso il problema delle etichette tecniche `phonePrefix` e `phoneNumber` visibili nel form.
- Resi statici i testi telefono nella registrazione, così non vengono trasformati in chiavi tecniche anche se il telefono ha una vecchia cache.
- Rafforzata la funzione `applyLang()` per non mostrare mai chiavi grezze quando manca una traduzione.
- Aggiornati cache-busting e service worker a `v27.3`.
- Mantenute allineate le copie root e `public/`.

Dopo il deploy conviene aprire il sito e fare un refresh completo dal browser del telefono.
