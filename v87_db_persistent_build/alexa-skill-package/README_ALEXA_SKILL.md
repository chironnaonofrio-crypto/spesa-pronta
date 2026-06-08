# Skill Alexa - Spesa Pronta

Questa cartella contiene il pacchetto base per creare la Skill Alexa “Spesa Pronta”.

## File
- `skill.json`: manifest della skill.
- `interactionModels/custom/it-IT.json`: modello vocale italiano.

## Endpoint da impostare
Nel pannello Amazon Developer, nella sezione Endpoint HTTPS, usa l’endpoint generato dall’app:

```text
https://spesa-pronta.it/api/alexa?householdId=ID_FAMIGLIA&token=TOKEN_CLOUD
```

L’app lo copia automaticamente dal pannello Cloud → Alexa.

## Comandi supportati
- “Alexa, apri Spesa Pronta”
- “Alexa, chiedi a Spesa Pronta cosa devo comprare”
- “Alexa, chiedi a Spesa Pronta di aggiungere acqua”
- “Alexa, chiedi a Spesa Pronta di segnare latte comprato”

## Nota
Alexa non può collegarsi “da sola” a un utente qualsiasi: la Skill deve essere creata nel pannello Amazon Developer e deve puntare all’endpoint cloud dell’utente/famiglia.
