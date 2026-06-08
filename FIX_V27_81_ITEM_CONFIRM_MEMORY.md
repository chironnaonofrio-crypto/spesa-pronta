# V27.81 - Item Confirm Memory

La memoria globale server viene aggiornata nel momento in cui l'utente preme **Conferma e aggiungi in casa** sul singolo articolo.

- Non aspetta più il pulsante generale **Completa controllo**.
- Non parte al semplice cambio categoria.
- Ogni articolo confermato viene inviato subito alla memoria globale server/Supabase.
- Il campione visivo locale resta separato e non ritarda il salvataggio server.
- Aggiunto guard anti doppio invio per la stessa scheda (`serverMemorySyncStarted`).
