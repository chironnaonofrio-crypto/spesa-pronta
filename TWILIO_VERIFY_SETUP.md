# Spesa Pronta V25 - Twilio Verify

Questa versione usa Twilio Verify per la verifica telefono via SMS.

Variabili Render:

- TWILIO_ACCOUNT_SID=AC...
- TWILIO_AUTH_TOKEN=...
- TWILIO_VERIFY_SERVICE_SID=VA...
- TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 (sandbox WhatsApp, per lista spesa)

`TWILIO_FROM_NUMBER` è opzionale e resta solo come fallback SMS classico.

Passi:
1. Twilio Console -> Verify -> Services -> Create service.
2. Nome: Spesa Pronta.
3. Canale: SMS.
4. Copia Service SID, inizia con VA.
5. Inseriscilo su Render come TWILIO_VERIFY_SERVICE_SID.
6. Save, rebuild and deploy.
