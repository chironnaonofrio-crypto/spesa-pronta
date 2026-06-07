# V27.47 - Blank Page Fixed

Correzione critica: in V27.46 il marker di versione nel body aveva aperto un commento HTML senza chiuderlo, quindi il browser nascondeva tutta la pagina e restava visibile solo il watermark CSS.

Fix:
- commento HTML chiuso correttamente
- root/public index puntano agli asset V27.47
- cache/service worker aggiornati
- seed 11.200 mantenuto integrato
- marker visibile: V27.47 Seed UI 11200 OK
