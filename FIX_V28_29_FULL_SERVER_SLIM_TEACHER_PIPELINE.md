# V28.29 Full Server / Slim Teacher Pipeline

Questa patch separa la pipeline immagine in due livelli:

1. **Server Spesa Pronta** riceve l'immagine piena/completa per mantenere contesto, forma e dettagli.
2. **Docente OpenAI** riceve solo l'immagine impacchettata/crop/compressa quando viene chiamato.

Obiettivo: il server ragiona prima con memoria locale/server, seed, cache, regole e fonti; OpenAI viene usato solo alla fine, con immagine alleggerita.

Modifiche principali:
- payload `/api/ai/vision` ora supporta `image` piena + `teacherImage` leggera;
- il client non sostituisce più l'immagine piena con il crop prima di chiamare il backend;
- il crop V28.05 diventa `teacherImageV2829`;
- il server passa a OpenAI solo `teacherImage`, mantenendo `fullImage` come riferimento pipeline;
- diagnostica `vision-pipeline-v2829-ready`.
