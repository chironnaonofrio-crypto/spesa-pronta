# Spesa Pronta V24 - SMS e WhatsApp

Variabili Render da aggiungere per SMS reale e lista WhatsApp via Twilio:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID` esempio `VA...` per SMS OTP gestito da Twilio Verify
- `TWILIO_FROM_NUMBER` esempio `+39...` per SMS
- `TWILIO_WHATSAPP_FROM` esempio `+14155238886` o numero WhatsApp Twilio abilitato

Flusso registrazione:
1. utente compila email + telefono;
2. email di verifica via Resend;
3. codice SMS a 6 cifre via Twilio;
4. dashboard sbloccata solo dopo email + telefono verificati.

Se Twilio non è configurato, il backend non si blocca: logga l'SMS come simulato e la lista WhatsApp viene generata/copiata ma non spedita.


## V25 - Scelta consigliata
Per la verifica telefono usa Twilio Verify: crea un Verify Service e inserisci `TWILIO_VERIFY_SERVICE_SID` su Render. Così non serve comprare subito un numero SMS locale USA con A2P 10DLC solo per gli OTP. `TWILIO_FROM_NUMBER` resta opzionale come fallback.
