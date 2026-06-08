# Google Assistant / Gemini — bridge Spesa Pronta

## Stato piattaforma Google
Google ha dismesso le **Conversational Actions** classiche per Google Assistant dal 13 giugno 2023. Quindi oggi non si pubblica più una skill vocale custom identica ad Alexa dal vecchio pannello Actions.

Questa versione aggiunge comunque un **endpoint compatibile** per collegare Google Assistant/Gemini tramite Android App Actions, automazioni, Dialogflow/bridge o webhook esterni.

## Endpoint

```text
https://spesa-pronta.it/api/google-assistant?householdId=TUO_HOUSEHOLD_ID&token=TOKEN_CLOUD
```

## Cosa sa fare

- leggere la lista della spesa cloud;
- aggiungere un prodotto alla lista impostando la quantità a `0`;
- aggiornare quantità e unità;
- segnare la spesa come fatta;
- usare la stessa logica e lo stesso database dell'endpoint Alexa.

## JSON diretto di test

POST verso l'endpoint:

```json
{"intent":"ReadShoppingListIntent"}
```

Aggiungi acqua:

```json
{"intent":"AddItemIntent","product":"acqua"}
```

Imposta crocchette cane:

```json
{"intent":"SetQuantityIntent","product":"crocchette cane","qty":10,"unit":"kg"}
```

## Dialogflow/bridge

Il server accetta anche richieste in formato Dialogflow ES/CX con:

- `queryResult.intent.displayName`
- `queryResult.parameters.product`
- `queryResult.parameters.quantity`
- `queryResult.parameters.unit`

Risponde con:

- `fulfillmentText`
- `fulfillment_response.messages`
- payload Google `simpleResponse`

## Frasi esempio

- Hey Google, chiedi a Spesa Pronta cosa devo comprare.
- Hey Google, aggiungi acqua alla lista Spesa Pronta.
- Hey Google, imposta crocchette cane a 10 kg.

## Nota importante

Alexa usa ancora una skill custom tradizionale. Google Assistant/Gemini, invece, oggi richiede un ponte/integrazione diversa perché le vecchie Conversational Actions sono state chiuse da Google. Il backend di Spesa Pronta è pronto: espone l'endpoint, aggiorna Supabase e restituisce risposte vocali compatibili.
