// netlify/functions/parse-voice-expense.js
// Recibe el texto transcripto de la voz de la persona (ej. "gasté 12000 pesos en medialunas")
// y le pide a Claude (Anthropic) que lo interprete de forma inteligente: monto, tipo
// (ingreso/egreso), categoría y concepto — mucho más preciso que un detector de palabras clave.

const CATEGORIES = ['Combustible', 'Almacén', 'Verdulería', 'Carnicería', 'Cena', 'Servicios', 'Otros'];

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const { transcript } = JSON.parse(event.body || '{}');
  if (!transcript) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta el texto transcripto' }) };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar ANTHROPIC_API_KEY' }) };
  }

  const systemPrompt = `Interpretás frases habladas en español argentino sobre gastos e ingresos personales, y devolvés SOLO un JSON, sin texto adicional, con este formato exacto:
{
  "amount": <número, el monto en pesos argentinos, o null si no se entendió>,
  "type": "egreso" o "ingreso",
  "category": una de estas exactas: ${CATEGORIES.join(', ')},
  "customCategory": <string corto sugerido SOLO si category es "Otros", si no null>,
  "fuelType": "Nafta", "GNC" o "Diesel" SOLO si category es "Combustible", si no null,
  "concept": <nombre CORTO y prolijo del concepto/producto, 2-4 palabras máximo, sin repetir el monto ni la categoría>
}

Reglas importantes:
- "concept" tiene que ser bien breve (ej. "Curso de CapCut", "Nafta YPF", "Medialunas"), nunca la frase completa que dijo la persona.
- Si la persona dice un número sin "mil" pero por el contexto (comida, nafta, etc.) es evidente que se refiere a miles de pesos (por ejemplo "carne 130" en Argentina normalmente significa $130.000, no $130), interpretalo así, usando tu criterio sobre precios reales y razonables en Argentina hoy.
- Palabras como "cobré", "gané", "ingresé", "recibí", "vendí", "me pagaron", o directamente decir "ingreso" al principio, indican ingreso. Todo lo demás, por defecto, es egreso.
- category tiene que ser EXACTAMENTE una de la lista, sin inventar otras. Si no encaja bien en ninguna, usá "Otros" y completá customCategory con una palabra corta (ej. "Panadería", "Farmacia", "Ropa", "Cursos").
- Devolvé SOLO el JSON, nada de explicaciones ni texto extra.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcript }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error de Anthropic:', data);
      return { statusCode: 500, body: JSON.stringify({ error: 'Error al interpretar con IA', detail: data }) };
    }

    const textResponse = data.content?.[0]?.text || '{}';
    const cleaned = textResponse.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('No se pudo parsear la respuesta de la IA:', textResponse);
      return { statusCode: 500, body: JSON.stringify({ error: 'Respuesta de IA no interpretable' }) };
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };
  } catch (err) {
    console.error('Error interno en parse-voice-expense:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno', detail: err.message }) };
  }
};
