# FIX V28.42 - Object Folder + Owner Locked Brain

- Ogni prodotto confermato crea/aggiorna una cartella oggetto server.
- Il server salva foto leggere fornite dall’utente: prodotto frontale, etichetta, scadenza, barcode quando disponibili.
- Il server sceglie automaticamente la foto migliore come immagine rappresentativa del prodotto.
- La scheda cervello mostra galleria foto, firma visiva, campi compilati/mancanti e JSON completo.
- Da server-brain.html il titolare può modificare nome, marca, formato, categoria, barcode, ingredienti, allergeni, colori, firma visiva e foto profilo.
- I valori salvati dal titolare diventano owner override: vincono su docente OpenAI, memoria, barcode ed etichetta futura.
- Aggiunto endpoint POST /api/ai/server-brain/update con auth household.
- Aggiornata cache a V28.42.
