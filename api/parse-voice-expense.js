// api/parse-voice-expense.js
// Recibe el texto transcripto de la voz de la persona (ej. "gasté 12000 pesos en medialunas")
// y le pide a Claude (Anthropic) que lo interprete de forma inteligente: monto, tipo
// (ingreso/egreso), categoría y concepto — mucho más preciso que un detector de palabras clave.

const CATEGORIES = [
  'Belleza y Cuidado Personal',
  'Limpieza del Hogar',
  'Mecánica y Mantenimiento',
  'Transporte',
  'Servicios',
  'Almacén, Súper y Mayoristas',
  'Panadería',
  'Salidas y Diversión',
  'Farmacia',
  'Librería y Capacitación',
  'Juguetería y Bazar',
  'Vestimenta',
  'Compras del Hogar y Electrónica',
  'Mascotas',
  'Otros'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { transcript } = req.body || {};
  if (!transcript) {
    return res.status(400).json({ error: 'Falta el texto transcripto' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY' });
  }

  const systemPrompt = `Interpretás frases habladas en español argentino sobre gastos e ingresos personales, y devolvés SOLO un JSON, sin texto adicional, con este formato exacto:
{
  "amount": <número, el monto en pesos argentinos, o null si no se entendió>,
  "type": "egreso" o "ingreso",
  "category": una de estas exactas: ${CATEGORIES.join(', ')},
  "customCategory": <string corto sugerido SOLO si category es "Otros", si no null>,
  "fuelType": "Nafta", "GNC", "Diesel" o "SUBE" SOLO si category es "Transporte", si no null,
  "concept": <nombre CORTO y prolijo del concepto/producto, 2-4 palabras máximo>
}

Guía de qué va en cada categoría (con ejemplos, pero usá tu criterio para casos parecidos que no estén acá):
- Belleza y Cuidado Personal: peluquería, uñas, pestañas, corte de pelo, tintura, skincare, shampoo, crema de enjuague, pasta dental, cepillo dental, perfumes, rasuradoras, maquillaje.
- Limpieza del Hogar: detergente, cepillo, trapo de piso, escoba, lavandina, desengrasante, bote de basura, papel higiénico.
- Mecánica y Mantenimiento: parche de rueda, repuestos del auto (rulemán, correa), mano de obra del mecánico, lavadero, cambio de aceite y filtro, service, instalación de GNC, rueda de auxilio/bici/moto, luces de auto o moto.
- Transporte: carga de SUBE, nafta, GNC, diesel.
- Servicios: recarga de celular, Netflix, Spotify, YouTube Premium, Disney, MELI, cualquier streaming o suscripción (incluidas IAs), luz, gas, internet, wifi, y honorarios de profesionales (abogado, freelancer, editor de videos, contador, asesor de imagen, psicólogo, etc).
- Almacén, Súper y Mayoristas: carne, arroz, fideos, gaseosas, aguas, jugos en polvo, servilletas, papel de cocina, lácteos, yogures, verduras, dulces, chocolates.
- Panadería: tortas, pan dulce, pre pizzas, facturas, bizcochos de grasa, pan, sándwiches de jamón y queso.
- Salidas y Diversión: desayuno/merienda/cena afuera, hamburguesas, McDonald's (con o sin la "s" final), cine, película, cafeterías, restaurantes, casinos, juegos de mesa, parques de diversiones.
- Farmacia: cualquier medicamento (ej. Metformina, ibuprofeno, etc).
- Librería y Capacitación: libros (de cualquier tipo, incluidos de finanzas/desarrollo personal), cuadernos, lapiceras, lápices, borradores, cursos online.
- Juguetería y Bazar: juguetes (autitos, cubo Rubik, muñecas), y artículos de bazar (jarros, platos, vasos).
- Vestimenta: ropa en general (campera, buzo, pulóver, jean, remera, zapatilla, anteojo, cinturón, bufanda, paraguas, reloj, chaleco, sweater, camisa, gorra, tapado, traje), incluso si solo dicen "ropa" sin especificar la prenda.
- Compras del Hogar y Electrónica: televisores, parlantes, celulares, pantallas LED, heladeras, freidoras, muebles, electrodomésticos en general.
- Mascotas: veterinaria, petshop, alimento y cuidado de cualquier mascota (perro, gato, peces, etc), piedritas para gato.
- Otros: SOLO si de verdad no encaja razonablemente en ninguna de las anteriores.

Reglas importantes sobre el MONTO:
- El monto puede venir como dígitos ("12000", "1.500.000") o escrito en palabras ("un millón quinientos mil", "noventa millones", "doce mil"). Tenés que convertir SIEMPRE las palabras a número, sin excepción. Nunca dejes amount en null solo porque el número vino en palabras.
- Si la persona dice un número chico sin "mil" pero por el contexto (comida, nafta, etc.) es evidente que se refiere a miles de pesos (ej. "carne 130" en Argentina normalmente significa $130.000, no $130), interpretalo así.

Reglas importantes sobre el TIPO (ingreso/egreso) — MUY IMPORTANTE, prestá especial atención acá:
- Si la frase contiene la palabra "ingreso", "ingresó", "ingresé", "cobré", "gané", "recibí", "vendí" o "me pagaron" EN CUALQUIER PARTE de la frase (aunque la gramática suene rara, como "me ingreso 50000 pesos"), el resultado SIEMPRE tiene que ser "type": "ingreso", sin excepciones. Esta regla tiene prioridad sobre cualquier otra interpretación.
- Solo si NINGUNA de esas palabras aparece, asumí "egreso" por defecto.

Reglas importantes sobre CONCEPT:
- NUNCA incluyas verbos de acción en el concepto: "gasté", "gaste", "ahorré", "ahorre", "gané", "gane", "cobré", "cobre", "ingresé", "ingrese", "pagué", "pague", "compré", "compre". Sacalos siempre, quedate solo con el producto o motivo.
- category tiene que ser EXACTAMENTE una de la lista, sin inventar otras. Elegí siempre la más parecida por sentido común, aunque el producto exacto no esté en los ejemplos (ej. "rasuradora Philips" → Belleza y Cuidado Personal, aunque no se haya nombrado esa marca). Usá "Otros" solo como último recurso.

Ejemplos (frase hablada → JSON esperado):
- "10000 pesos en nafta gasté" → {"amount": 10000, "type": "egreso", "category": "Transporte", "customCategory": null, "fuelType": "Nafta", "concept": "Nafta"}
- "me ingreso un millón quinientos mil pesos argentinos" → {"amount": 1500000, "type": "ingreso", "category": "Otros", "customCategory": "Ingreso Extra", "fuelType": null, "concept": "Ingreso Extra"}
- "me ingreso 50000 pesos" → {"amount": 50000, "type": "ingreso", "category": "Otros", "customCategory": "Ingreso Extra", "fuelType": null, "concept": "Ingreso Extra"}
- "ingreso 50000 pesos de un curso de capcut" → {"amount": 50000, "type": "ingreso", "category": "Librería y Capacitación", "customCategory": null, "fuelType": null, "concept": "Curso de CapCut"}
- "hoy compre ropa a 100000 pesos" → {"amount": 100000, "type": "egreso", "category": "Vestimenta", "customCategory": null, "fuelType": null, "concept": "Ropa"}
- "gorra deportiva 5600" → {"amount": 5600, "type": "egreso", "category": "Vestimenta", "customCategory": null, "fuelType": null, "concept": "Gorra deportiva"}
- "rasuradora philips 12000" → {"amount": 12000, "type": "egreso", "category": "Belleza y Cuidado Personal", "customCategory": null, "fuelType": null, "concept": "Rasuradora Philips"}
- "macdonald 8000" → {"amount": 8000, "type": "egreso", "category": "Salidas y Diversión", "customCategory": null, "fuelType": null, "concept": "McDonald's"}
- "cine 15000" → {"amount": 15000, "type": "egreso", "category": "Salidas y Diversión", "customCategory": null, "fuelType": null, "concept": "Cine"}
- "gasté noventa millones en un auto" → {"amount": 90000000, "type": "egreso", "category": "Otros", "customCategory": "Vehículos", "fuelType": null, "concept": "Auto"}
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
    console.error('Error interno en parse-voice-expense:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
