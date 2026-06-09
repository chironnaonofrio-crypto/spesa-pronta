# V28.27 Scan Image Size Pipeline Fix

Corregge il problema reale dietro al messaggio ricorrente “foto/immagine troppo piccola”.

Modifiche:
- le foto da camera/live non vengono più compresse a 720/620 px con lato corto troppo basso; ora usano 1080 px e qualità più stabile.
- le foto da scatta/carica foto usano 1080 px invece di 760 px.
- il controllo qualità accetta foto rettangolari reali (long side >= 720, short side >= 360) invece di pretendere entrambi i lati >= 480.
- il crop prima del docente OpenAI non produce più immagini troppo piccole: profili crop portati a 820–960 px con qualità 0.68–0.70.
- se la sorgente è già piccola, il crop viene saltato e si mantiene l’immagine intera.

Obiettivo: evitare scansioni inutilizzabili senza rimuovere il controllo qualità.
