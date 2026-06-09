# V28.12 First Inventory Guard

- Rimossa la pillola "Fatta da verificare": per sbloccare l’account bisogna completare davvero il controllo iniziale.
- Aggiunta sessione di controllo iniziale sospesa per 24 ore.
- Se l’utente si disconnette prima di completare, gli articoli già aggiunti vengono ripristinati al rientro entro 24h.
- Se passano 24h, la sessione sospesa scade e gli articoli temporanei tornano a 0.
- Aggiunta pillola premium "Ricomincia da 0 articoli".
- I pulsanti "Completa controllo" e "Svuota risultati" non sono più sticky davanti allo schermo: restano in fondo al contenuto.
