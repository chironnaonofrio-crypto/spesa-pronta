# Spesa Pronta V23 - Recovery database cifrato

Questa versione evita il crash `unsupported state or unable to authenticate data` quando il database contiene dati cifrati con un APP_SECRET diverso o con un vecchio formato non leggibile.

Cosa fa:
- prova a decriptare il record principale `main`;
- se fallisce, crea un backup nel database con una key tipo `main_backup_decrypt_failed_<timestamp>`;
- avvia un database vuoto e lo salva cifrato con l`APP_SECRET` attuale;
- l`app torna online invece di bloccarsi in deploy.

Nota: se esistevano utenti/prodotti reali, per recuperarli serve ripristinare il vecchio `APP_SECRET`. Se l`app era ancora in test, questa recovery è la soluzione più rapida.
