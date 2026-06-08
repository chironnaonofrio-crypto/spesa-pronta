# FIX V27.80 - Expiry Rescan Guard

Correzione bug follow-up: dopo la scansione etichetta, se l'app è nello step scadenza e l'utente fotografa di nuovo il prodotto o l'etichetta senza una data leggibile, la scheda non viene sovrascritta, non riparte da prodotto e non crea doppioni.

Flusso protetto:
1. Prodotto
2. Etichetta / ingredienti
3. Scadenza
4. Conferma

Se nello step 3 non viene letta una data, l'app resta sulla stessa scheda e chiede solo la foto della scadenza o la scadenza a voce.
