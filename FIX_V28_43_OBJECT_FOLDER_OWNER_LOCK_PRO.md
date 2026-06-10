# FIX V28.43 - Object Folder Owner Lock Pro

Versione di controllo prima upload.

- Allineata la pagina `server-brain.html` root e public: ora la rotta principale serve la pagina nuova completa, non una pagina vecchia senza editor.
- Aggiunto editor titolare realmente funzionante nel Cervello Server.
- Aggiunto campo owner token opzionale per proteggere le modifiche se viene impostata la variabile `SERVER_BRAIN_OWNER_TOKEN` o `ADMIN_TOKEN`.
- Aggiunto sblocco valori titolare.
- Le modifiche titolare ora possono anche svuotare campi sbagliati: barcode, allergeni, tracce, ingredienti, colori, firma, packaging.
- Le foto profilo scelte dalla galleria vengono salvate come rappresentative.
- La scheda memoria viene rigenerata a ogni apertura del Cervello Server, così mostra override e cartella oggetto aggiornati.
- Evitato il salvataggio di data URL troncati/non validi: il server salva solo immagini base64 integre e leggere.
- Aggiornata cache a V28.43 e query script a `v=2843`.
