// api/parse-libertad-voice.js
// Interpreta frases habladas para 3 formularios distintos de Libertad Financiera:
// registrar una deuda, cargar un ingreso extra, o registrar una compra de inversión.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { transcript, context } = req.body || {};
  if (!transcript || !context) {
    return res.status(400).json({ error: 'Faltan datos (transcript o context)' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY' });
  }

  let systemPrompt = '';

  if (context === 'deuda') {
    systemPrompt = `Interpretás frases habladas en español argentino sobre una DEUDA que la persona tiene, y devolvés SOLO un JSON, sin texto adicional:
{
  "name": <nombre corto del acreedor o la deuda, ej. "Yola", "Tarjeta Visa">,
  "amount": <número, el monto TOTAL de la deuda en pesos argentinos>,
  "minPayment": <número, el pago mínimo mensual en pesos, si no lo menciona poné una estimación razonable (10% del monto total)>
}
Reglas: convertí números en palabras a dígitos (ej. "cuatrocientos mil" → 400000). Si menciona un monto en dólares, convertilo a pesos usando un tipo de cambio aproximado de 1400 ARS por USD, y aclaralo en el nombre si corresponde (ej. "Yola (USD)"). Devolvé SOLO el JSON.
Ejemplo: "debo cuatrocientos mil pesos a Yola, pago mínimo cincuenta mil" → {"name": "Yola", "amount": 400000, "minPayment": 50000}`;
  } else if (context === 'ingreso_extra') {
    systemPrompt = `Interpretás frases habladas en español argentino sobre un INGRESO EXTRA que la persona recibió, y devolvés SOLO un JSON, sin texto adicional:
{
  "category": una de estas exactas: "E-commerce", "Venta de Activo", "Cursos / Digital", "Servicios", "Otros",
  "customCategory": <string corto SOLO si category es "Otros", si no null>,
  "detail": <detalle corto de qué fue, ej. "Venta de curso online">,
  "qty": <cantidad de unidades vendidas, si no se menciona poné 1>,
  "unitPrice": <precio unitario en pesos>,
  "amount": <monto total si no se puede separar en cantidad x precio>
}
Reglas: convertí números en palabras a dígitos. Si vendió "un curso" o algo similar sin cantidad, qty es 1. Devolvé SOLO el JSON.
Ejemplo: "vendí un curso por 50000 pesos" → {"category": "Cursos / Digital", "customCategory": null, "detail": "Venta de curso online", "qty": 1, "unitPrice": 50000, "amount": 50000}`;
  } else if (context === 'inversion') {
    systemPrompt = `Interpretás frases habladas en español argentino sobre una COMPRA DE INVERSIÓN (acciones, ETF, CEDEARs), y devolvés SOLO un JSON, sin texto adicional:
{
  "name": <nombre del activo, ej. "Apple", "S&P 500", "CEDEAR Nvidia">,
  "qty": <cantidad de unidades/acciones compradas>,
  "unitPrice": <precio unitario en pesos por unidad>
}
Reglas: convertí números en palabras a dígitos. Devolvé SOLO el JSON.
Ejemplo: "compré 10 acciones de Apple a 500 pesos cada una" → {"name": "Apple", "qty": 10, "unitPrice": 500}`;
  } else {
    return res.status(400).json({ error: 'Contexto no reconocido' });
  }

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
        max_tokens: 250,
        system: systemPrompt,
        messages: [{ role: 'user', content: transcript }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error de Anthropic:', data);
      return res.status(500).json({ error: 'Error al interpretar con IA', detail: data });
    }

    const textResponse = data.content?.[0]?.text || '{}';
    const cleaned = textResponse.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('No se pudo parsear la respuesta de la IA:', textResponse);
      return res.status(500).json({ error: 'Respuesta de IA no interpretable' });
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Error interno en parse-libertad-voice:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
