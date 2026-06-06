// Alexa hosted/Node example: forward every Alexa request to your Spesa Pronta cloud API.
// Set SPESA_PRONTA_ENDPOINT to: https://yourdomain.com/api/alexa?householdId=YOUR_HOUSEHOLD_ID
export const handler = async (event) => {
  const endpoint = process.env.SPESA_PRONTA_ENDPOINT;
  if (!endpoint) {
    return speak('Endpoint Spesa Pronta non configurato.');
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  return await res.json();
};

function speak(text) {
  return {
    version: '1.0',
    response: {
      outputSpeech: { type: 'PlainText', text },
      shouldEndSession: true
    }
  };
}
