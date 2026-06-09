# V28.28 Primary Subject Guard

Fix mirato al caso in cui la Vision AI prende un oggetto laterale o lo sfondo invece del prodotto centrale.

- In modalità prodotto/Scatta foto il crop docente privilegia il centro dell'immagine.
- Prompt server aggiornati: analizza solo il prodotto centrale/più grande.
- Persone, tavolo, piatti e oggetti laterali non rendono non-idoneo un prodotto centrale valido.
- Se Coca-Cola/cola o bottiglia alimentare è letta nel prodotto centrale, categoria soft_drinks e non object non idoneo.
