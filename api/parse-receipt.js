// api/parse-receipt.js
// Recibe una foto de ticket o un PDF de factura, y le pide a Claude que "vea" o "lea"
// el documento y devuelva el monto, la categoría y el concepto — mismo esquema que
// usa la carga por voz.

const CATEGORIES = [
  'Belleza y Cuidado Personal',
  'Limpieza del Hogar',
  'Mecánica y Mantenimiento',
  'Transporte',
  'Delivery',
  'Apps',
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

import { requireAiAccess } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // 🔒 Solo usuarios logueados: si no, cualquiera desde afuera podía gastar
  // los créditos de la API de IA llamando a esta URL directamente.
  const authUser = await requireAiAccess(req, res);
  if (!authUser) return;

  const { base64Data, images, mediaType, kind } = req.body || {};
  const isTiles = kind === 'image-tiles';
  const isMultiImage = (kind === 'multi-image' || isTiles) && Array.isArray(images) && images.length > 0 && images.length <= 6;
  const isPdfDocument = kind === 'pdf-document';

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
  "amount": <número con sus centavos (ej. 44017.24), el monto TOTAL a pagar en pesos argentinos, o null si no se pudo leer>,
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
- Delivery: pedidos de comida o compras entregadas a domicilio (Rappi, PedidosYa, etc.).
- Apps: viajes en aplicaciones como Uber, Didi, Cabify.
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
- El monto tiene que ser el TOTAL final a pagar del ticket/factura — buscá específicamente la línea que dice "TOTAL" (no "Efectivo", no "Vuelto", no "Cambio", esos son otra cosa). En un recibo de sueldo, el monto es el "TOTAL NETO".
- Los tickets argentinos usan el punto como separador de miles y la coma como separador decimal: "$5.890,00" significa cinco mil ochocientos noventa pesos (5890), NO 5,89 ni 589000. IMPORTANTE: si hay MÁS DE UN PUNTO o el número es largo, seguís usando la MISMA regla — por ejemplo "707.104,16" significa setecientos siete mil ciento cuatro con dieciséis centavos (707104.16), NUNCA lo recortes a "707" ni tomes solo la primera parte antes del primer punto. Leé el número completo de punta a punta antes de convertirlo. NUNCA redondees: si el total tiene centavos, devolvelos (",24" → .24).
- Si te llegan VARIAS imágenes (varias páginas de un mismo PDF), es UN SOLO comprobante — el monto total puede estar en cualquiera de las páginas (a veces en la primera, a veces en la última, a veces en un comprobante de pago que viene en una página aparte). Revisá TODAS las páginas antes de decidir el monto.
- Si el documento es un RECIBO DE SUELDO, LIQUIDACIÓN DE HABERES, o similar (tiene campos como "LEGAJO", "REM. ASIGNADA", "TOTAL NETO", nombre de un empleado y un empleador) — es un "ingreso" (es plata que la persona cobró, no que gastó), el monto es el "TOTAL NETO", category es "Otros", y concept es "Sueldo" (o "Sueldo" + el nombre de la empresa si se lee, ej. "Sueldo Gulma SRL").
- Para cualquier otro caso, casi siempre es un "egreso" (es un comprobante de algo que se pagó). Solo poné "ingreso" si es evidente que es un recibo de cobro a favor de la persona (recibo de sueldo, transferencia recibida, etc.).
- "concept" tiene que ser el nombre del comercio o servicio si se lee (ej. "Factura de Edesur", "VEP AFIP", "Boleta de patentes"), o si no es legible, un resumen corto de lo comprado, nunca una lista larga de todos los ítems.
- category tiene que ser EXACTAMENTE una de la lista.
- Si te llegan varias imágenes que son PARTES de un mismo ticket largo (cortado de arriba a abajo, con un poco de superposición entre una parte y la siguiente), es UN SOLO ticket: no sumes dos veces lo que aparece repetido en el borde, y el TOTAL suele estar en la última parte.
- Comprobantes de transferencia o pago (Mercado Pago, Ualá, Brubank, bancos, capturas de pantalla): el monto es el importe transferido o pagado. Es "egreso" si la persona pagó o envió plata, e "ingreso" si dice "Recibiste", "Te transfirieron" o similar. concept = a quién se le pagó o de quién se recibió.
- La imagen puede ser chica, borrosa o estar de costado: mirala con atención antes de rendirte. Solo si de verdad no se lee el monto, devolvé amount: null.
- Devolvé SOLO el JSON, nada de explicaciones ni texto extra.`;

  // Armamos el bloque de contenido: PDF completo (la IA lo lee directo, sin necesitar
  // que el celular lo convierta antes en imágenes), varias imágenes, o una sola imagen.
  const contentBlocks = isPdfDocument
    ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }]
    : isMultiImage
      ? images.map(img => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data: img } }))
      : [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } }];

  const userText = isTiles
    ? 'Estas imágenes son partes, de arriba a abajo, de un mismo ticket largo. Analizalas todas y devolveme el JSON pedido.'
    : (isMultiImage || isPdfDocument)
      ? 'Estas son las páginas de un mismo comprobante/factura. Analizalas todas y devolveme el JSON pedido.'
      : 'Analizá este comprobante y devolveme el JSON pedido.';

  // Primero una lectura rápida (sin razonamiento, responde en pocos segundos);
  // si no encuentra el monto, una segunda pensando con más detalle
  // Si el modelo nuevo no estuviera disponible en la cuenta, usamos el de antes (así nunca se rompe)
  let useLegacyModel = false;
  async function askClaude(detailed) {
    const modelParams = useLegacyModel
      ? { model: 'claude-haiku-4-5-20251001', max_tokens: 300 }
      : detailed
        ? { model: 'claude-haiku-5-5', max_tokens: 4000, output_config: { effort: 'high' } }
        : { model: 'claude-haiku-5-5', max_tokens: 400, thinking: { type: 'disabled' }, output_config: { effort: 'low' } };
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        ...modelParams,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            ...contentBlocks,
            { type: 'text', text: userText }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Error de Anthropic:', JSON.stringify(data));
      if (!useLegacyModel && (response.status === 400 || response.status === 404)) {
        useLegacyModel = true;
        return askClaude(detailed);
      }
      return { error: data?.error?.message || JSON.stringify(data) };
    }
    // La respuesta puede traer bloques de razonamiento antes del texto
    const textResponse = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || '{}';
    const match = textResponse.replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    try {
      return { parsed: JSON.parse(match ? match[0] : textResponse) };
    } catch (e) {
      console.error('No se pudo parsear la respuesta de la IA:', textResponse);
      return { parsed: null };
    }
  }

  try {
    let result = await askClaude(false);
    if (result.error) {
      return res.status(500).json({ error: 'Error al interpretar con IA', detail: result.error });
    }
    if (!result.parsed || result.parsed.amount == null) {
      const retry = await askClaude(true);
      if (retry.parsed) result = retry;
    }
    if (!result.parsed) {
      return res.status(500).json({ error: 'Respuesta de IA no interpretable' });
    }

    return res.status(200).json(result.parsed);
  } catch (err) {
    console.error('Error interno en parse-receipt:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
