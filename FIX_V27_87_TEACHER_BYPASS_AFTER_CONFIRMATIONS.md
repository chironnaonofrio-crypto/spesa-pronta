# FIX V27.87 - Teacher Bypass After Confirmations

- Dopo almeno 2 conferme coerenti dello stesso prodotto, la scansione prova prima memoria locale/server.
- Se la memoria server globale riconosce il prodotto confermato più volte, OpenAI docente non viene chiamato.
- Badge nuovo: “Docente non usato: prodotto già imparato”.
- Il docente OpenAI resta attivo solo se memoria locale/server è incerta o se etichetta attuale crea conflitto.
- Match server più prudente: richiede almeno 2 conferme e coerenza tra nome/marca/token specifici.
