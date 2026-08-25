// api/parse-receipt.js
// Recibe una foto de ticket o un PDF de factura, y le pide a Claude que "vea" o "lea"
// el documento y devuelva el monto, la categoría y el concepto — mismo esquema que
// usa la carga por voz.

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

  const { base64Data, images, mediaType, kind } = req.body || {};
  const isMultiImage = kind === 'multi-image' && Array.isArray(images) && images.length > 0;

  if (!isMultiImage && !base64Data) {
    return res.status(400).json({ error: 'Falta el archivo' });
  }
  if (!mediaType) {
    return res.status(400).json({ error: 'Falta el tipo de archivo' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY' });
  }

  const systemPrompt = `Analizás fotos de tickets/comprobantes de compra, o facturas de servicios en PDF (luz, gas, internet, etc.), de Argentina, y devolvés SOLO un JSON, sin texto adicional, con este formato exacto:
{
  "amount": <número, el monto TOTAL a pagar en pesos argentinos, o null si no se pudo leer>,
  "type": "egreso" o "ingreso",
  "category": una de estas exactas: ${CATEGORIES.join(', ')},
  "customCategory": <string corto sugerido SOLO si category es "Otros", si no null>,
  "fuelType": "Nafta", "GNC", "Diesel" o "SUBE" SOLO si category es "Transporte", si no null,
  "concept": <nombre CORTO y prolijo del comercio o servicio, 2-4 palabras máximo>
}

Guía de categorías (con ejemplos, usá tu criterio para casos parecidos):
- Belleza y Cuidado Personal: peluquería, cosmética, farmacia de belleza.
- Limpieza del Hogar: artículos de limpieza.
- Mecánica y Mantenimiento: talleres, repuestos, service.
- Transporte: nafta, GNC, diesel, SUBE.
- Servicios: luz, gas, agua, internet, streaming, suscripciones, honorarios profesionales.
- Almacén, Súper y Mayoristas: SOLO cuando el ticket muestra compra de mercadería en volumen para el hogar (varios productos de almacén, verdulería, carnicería, limpieza, etc. en una misma compra).
- Panadería: panaderías, confiterías.
- Salidas y Diversión: cualquier ticket de un lugar donde se consume comida o bebida en el momento (cafeterías, locales de comida rápida, restaurantes, bares, heladerías, cines, entretenimiento) — aunque el ticket no diga el nombre del local, si los ítems son cosas como "café", "tostado", "medialunas", "hamburguesa", "combo", "menú", "gaseosa individual", etc., es Salidas y Diversión, NUNCA "Almacén, Súper y Mayoristas".
- Farmacia: medicamentos.
- Librería y Capacitación: librerías, cursos.
- Juguetería y Bazar: jugueterías, bazares.
- Vestimenta: ropa, calzado, accesorios.
- Compras del Hogar y Electrónica: electrodomésticos, muebles, tecnología.
- Mascotas: veterinarias, petshops.
- Otros: SOLO si de verdad no encaja en ninguna.

Reglas:
- El monto tiene que ser el TOTAL final a pagar del ticket/factura — buscá específicamente la línea que dice "TOTAL" (no "Efectivo", no "Vuelto", no "Cambio", esos son otra cosa).
- Los tickets argentinos usan el punto como separador de miles y la coma como separador decimal: "$5.890,00" significa cinco mil ochocientos noventa pesos (5890), NO 5,89 ni 589000. Prestá mucha atención a esto para no leer mal el monto.
- Si te llegan VARIAS imágenes (varias páginas de un mismo PDF), es UN SOLO comprobante — el monto total puede estar en cualquiera de las páginas (a veces en la primera, a veces en la última, a veces en un comprobante de pago que viene en una página aparte). Revisá TODAS las páginas antes de decidir el monto.
- Casi siempre es un "egreso" (es un comprobante de algo que se pagó). Solo poné "ingreso" si es evidente que es un recibo de cobro a favor de la persona.
- "concept" tiene que ser el nombre del comercio o servicio si se lee (ej. "Factura de Edesur", "VEP AFIP", "Boleta de patentes"), o si no es legible, un resumen corto de lo comprado, nunca una lista larga de todos los ítems.
- category tiene que ser EXACTAMENTE una de la lista.
- Si las imágenes no se pueden leer bien, devolvé amount: null.
- Devolvé SOLO el JSON, nada de explicaciones ni texto extra.`;

  // Armamos los bloques de imagen: uno solo, o varios si son las páginas de un PDF
  const imageBlocks = isMultiImage
    ? images.map(img => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data: img } }))
    : [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } }];

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
        messages: [{
          role: 'user',
          content: [
            ...imageBlocks,
            { type: 'text', text: isMultiImage ? 'Estas son las páginas de un mismo comprobante/factura. Analizalas todas y devolveme el JSON pedido.' : 'Analizá este comprobante y devolveme el JSON pedido.' }
          ]
        }]
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
    console.error('Error interno en parse-receipt:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
