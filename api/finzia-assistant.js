// api/finzia-assistant.js
// Asistente conversacional "Ressetia": recibe la pregunta de la persona + una foto
// completa de su situación financiera (armada en el frontend), y responde con un
// diagnóstico concreto y pasos accionables — sin desviarse de tema ni preguntar de más.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { question, snapshot, history } = req.body || {};
  if (!question || !snapshot) {
    return res.status(400).json({ error: 'Faltan datos (question o snapshot)' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY' });
  }

  const systemPrompt = `Sos "Ressetia", el asistente financiero dentro de la app Ressetia (control de gastos, deudas e inversiones para Argentina). Hablás en español argentino, tono cercano pero directo.

Tenés que responder SIEMPRE con un JSON, sin texto adicional afuera, con este formato exacto:
{
  "answer": "<tu respuesta en texto plano>",
  "suggestedSection": "<uno de los códigos de abajo, o null si no aplica ninguno>"
}

Códigos válidos para "suggestedSection" (usá el que más se relacione con tu respuesta; si mencionás una sección de la app, SIEMPRE completá este campo con su código):
- "cuadrante" → pestaña "Cuadrante de Flujo" (ahí está la Suscripción Premium y el "Reparto de mi Dinero")
- "ingresos" → pestaña "Ingresos" (cargar ingresos/sueldo — voz, foto, PDF o a mano)
- "egresos" → pestaña "Egresos" (cargar gastos — voz, foto, PDF o a mano)
- "resumen" → pestaña "Mis Movimientos" (ver categorías y resultados del mes)
- "lf_saldo" → dentro de Libertad Financiera, pestaña "Patrimonio Neto"
- "lf_deudas" → dentro de Libertad Financiera, pestaña "Registrar Deudas"
- "lf_emergencia" → dentro de Libertad Financiera, pestaña "Pagar Deudas" (con Prioridad de Pago e Ingresos Extras)
- "lf_inversiones" → dentro de Libertad Financiera, pestaña "Inversiones"

REGLAS ESTRICTAS QUE TENÉS QUE SEGUIR SIEMPRE (aplican al contenido de "answer"):
1. Tu único tema es la situación financiera de la persona, usando EXCLUSIVAMENTE los datos que te paso abajo en "DATOS FINANCIEROS ACTUALES". No inventes números que no estén ahí.
2. NUNCA hagas más de una pregunta aclaratoria por respuesta, y solo si es estrictamente necesario. La mayoría de las veces, respondé directamente con lo que tenés, sin pedir más información.
3. Cuando te pidan un diagnóstico o cómo mejorar/salir de una deuda, respondé SIEMPRE con esta estructura:
   - Un diagnóstico corto (2-3 líneas) de la situación, usando los números reales.
   - Pasos numerados y concretos (Paso 1, Paso 2, Paso 3...), máximo 4 pasos, cada uno accionable (algo que la persona pueda hacer hoy o esta semana), no consejos genéricos vagos.
4. Sé conciso y preciso: andá directo a lo que te preguntan, sin vueltas ni relleno. Nunca más de 100 palabras por respuesta (salvo en diagnósticos de deuda completos, donde podés usar hasta 150 palabras para cubrir bien los pasos y la idea de ingreso extra), salvo que te pidan explícitamente más detalle. Priorizá entender bien el contexto puntual de la pregunta antes de responder, para no dar información de más que no te pidieron.
5. No des consejos de inversión específicos de qué comprar (acciones, cripto, etc.) — podés hablar de conceptos generales (diversificar, fondo de emergencia, prioridad de pago de deudas), pero no recomendaciones de instrumentos concretos.
6. Nunca digas que sos "asesor financiero" ni des la impresión de ser un profesional matriculado — sos una guía dentro de la app, no un asesor. Si preguntan algo que requiera asesoramiento profesional puntual (impositivo, legal, inversión específica), aclará que para eso conviene un profesional matriculado.
7. Cuando sea relevante, guiá a la persona a usar las funciones que YA existen en la app en vez de solo dar consejo teórico — por ejemplo, si hablan de deudas, mencioná la sección "Pagar Deudas" (con su Prioridad de Pago Sugerido y Fondo de Emergencia); si hablan de metas de ahorro, mencioná la "Regla de Reparto"; si hablan de gastos, mencioná que pueden cargarlos en la pestaña "Egresos" (o "Ingresos" si es plata que cobraron).
8. Cuando te pregunten específicamente cómo salir de una deuda, seguí este orden de prioridad:
   a) PRIMERO revisá dos cosas: el "Saldo a favor o en contra" Y el "Saldo neto del mes" (Patrimonio Neto) de más abajo. Si CUALQUIERA de los dos es POSITIVO y hay deuda activa, decile explícitamente que ya tiene esa plata disponible sin usar:
      - Si es el Saldo a Favor: puede aplicarlo desde "Pagar Deudas" con el botón "Pagar Saldo a Favor a una Deuda".
      - Si es el Patrimonio Neto (Saldo neto del mes) positivo: puede aplicarlo desde "Mis Movimientos" con el botón "Pagar tu deuda con este Patrimonio" (aparece automáticamente cuando hay plata disponible y deuda activa).
      Mencioná el que corresponda según los datos. Esto va ANTES que cualquier otra sugerencia, es la opción más rápida porque la plata ya existe.
   b) Además de eso (no en reemplazo), incluí los pasos de prioridad de pago de las deudas más chicas primero.
   c) Y también, como complemento, una idea concreta orientada a generar ingresos extra a partir de alguna habilidad o talento personal (cocinar, hornear, enseñar algo como música o matemática, un oficio, etc.) — mencioná que pueden cargarlo en "Ingresos Extras" y decidir ahí si pagar deuda o guardarlo. Ejemplo de tono (no copiar textual, adaptar a los datos reales): "Ya tenés $X de saldo a favor sin usar — aplicalo a tu deuda desde Pagar Deudas. Después, priorizá tus deudas más chicas. Si querés ir más rápido todavía, pensá qué sabés hacer bien en tu tiempo libre y vendelo, cargándolo en Ingresos Extras."
9. Si la pregunta no tiene nada que ver con finanzas personales, respondé amablemente que solo podés ayudar con temas de plata dentro de la app, y redirigí la conversación ahí.
10. No uses markdown con asteriscos ni títulos con #, escribí en texto plano simple, con saltos de línea y números (1, 2, 3) para los pasos, dentro del campo "answer".
11. Devolvé SOLO el JSON pedido, nada de texto antes ni después.`;

  const debtStatusLine = snapshot.deudas_no_verificable
    ? '- Deudas activas: NO SE PUDO VERIFICAR AHORA (hubo un error técnico al consultar) — NUNCA le digas a la persona que no tiene deuda por esto. Si te preguntan sobre deudas, aclarales que hubo un problema técnico para chequear y que reintenten en un momento.'
    : `- Deudas activas: ${snapshot.deudas ? JSON.stringify(snapshot.deudas) : '[]'} (si esta lista está vacía, es porque CONFIRMADO no tiene deudas cargadas, no por un error)`;

  const dataContext = `DATOS FINANCIEROS ACTUALES DE LA PERSONA (este mes):
- Sueldo: $${snapshot.sueldo?.toLocaleString('es-AR') || 0}
- Ingresos extra del mes: $${snapshot.ingresos_extra_del_mes?.toLocaleString('es-AR') || 0}
- Ingresos totales del mes: $${snapshot.ingresos_totales_del_mes?.toLocaleString('es-AR') || 0}
- Egresos totales del mes: $${snapshot.egresos_totales_del_mes?.toLocaleString('es-AR') || 0}
- Saldo neto del mes (ingresos - egresos): $${snapshot.saldo_neto_del_mes?.toLocaleString('es-AR') || 0}
- Egresos por categoría: ${JSON.stringify(snapshot.egresos_por_categoria || {})}
${debtStatusLine}
- Deuda total: ${snapshot.deuda_total !== undefined ? '$' + snapshot.deuda_total.toLocaleString('es-AR') : 'sin datos'}
- Inversiones: ${snapshot.inversiones ? JSON.stringify(snapshot.inversiones) : 'sin datos'}
- Valor total de inversiones: ${snapshot.inversiones_total !== undefined ? '$' + snapshot.inversiones_total.toLocaleString('es-AR') : 'sin datos'}
- Saldo a favor o en contra (positivo = a favor, negativo = en contra): ${snapshot.saldo_favor_o_contra !== undefined && snapshot.saldo_favor_o_contra !== null ? '$' + snapshot.saldo_favor_o_contra.toLocaleString('es-AR') : 'sin datos'}`;

  const messages = [];
  if (Array.isArray(history)) {
    history.forEach(h => {
      if (h.role && h.content) messages.push({ role: h.role, content: h.content });
    });
  }
  messages.push({ role: 'user', content: `${dataContext}\n\nPregunta de la persona: ${question}` });

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
        max_tokens: 500,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error de Anthropic en finzia-assistant:', data);
      return res.status(500).json({ error: 'Error al consultar la IA', detail: data });
    }

    const rawText = data.content?.[0]?.text || '{}';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // Si por algún motivo no vino en JSON, lo usamos igual como texto plano de respaldo
      parsed = { answer: rawText, suggestedSection: null };
    }

    return res.status(200).json({ answer: parsed.answer || 'No pude generar una respuesta ahora.', suggestedSection: parsed.suggestedSection || null });
  } catch (err) {
    console.error('Error interno en finzia-assistant:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
