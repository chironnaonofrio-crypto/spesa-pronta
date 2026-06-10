# FIX V28.62 PRO Visual Truth Memory

- Blocco strutturale: una bottiglia con liquido scuro e fascia etichetta forte non può più diventare acqua.
- Match memoria visiva gratuita più aggressivo ma controllato prima di OpenAI.
- Nuove ancore visive salvate nella cartella oggetto: liquido scuro, fascia etichetta, acqua impossibile, cola/bibita probabile.
- Se la foto è simile a un prodotto già confermato, il server precompila da memoria con 0 token OpenAI.
- Fallback corretto: se non matcha, classifica prudente come cola/bibita da confermare, non acqua.
