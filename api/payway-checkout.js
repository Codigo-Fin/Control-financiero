// api/payway-checkout.js
//
// Genera un link de pago con Payway (Formulario de Pago) para que el usuario
// pague con tarjeta sin pasar por Mercado Pago.
//
// Esta versión llama DIRECTO a la API REST de Payway (sin el SDK de npm, que
// tenía un bug: no anidaba bien el campo "template_id" como Payway lo pide de
// verdad, y siempre devolvía "param_required: template_id").
//
// Variables de entorno necesarias en Vercel (Settings → Environment Variables):
//   PAYWAY_PRIVATE_KEY   -> secreta, nunca se expone al navegador
//   PAYWAY_PUBLIC_KEY    -> tu clave pública
//   PAYWAY_SITE_ID       -> tu Site ID
//   PAYWAY_TEMPLATE_ID   -> tu Template ID
//   PAYWAY_AMBIENT       -> "developer" (pruebas) o "production" (cuando lances)

const ENDPOINT_SANDBOX = 'https://developers.decidir.com/api/v1/checkout-payment-button';
const ENDPOINT_PRODUCTION = 'https://live.decidir.com/api/v1/checkout-payment-button';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { plan, userEmail, userId } = req.body;

    if (!plan || !['mensual', 'anual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    const PRICES = { mensual: 6999, anual: 69990 };
    const amount = PRICES[plan];

    const ambient = process.env.PAYWAY_AMBIENT || 'developer';
    const publicKey = process.env.PAYWAY_PUBLIC_KEY;
    const privateKey = process.env.PAYWAY_PRIVATE_KEY;
    const siteId = process.env.PAYWAY_SITE_ID;
    const templateId = process.env.PAYWAY_TEMPLATE_ID;

    const missingVars = [];
    if (!publicKey) missingVars.push('PAYWAY_PUBLIC_KEY');
    if (!privateKey) missingVars.push('PAYWAY_PRIVATE_KEY');
    if (!siteId) missingVars.push('PAYWAY_SITE_ID');
    if (!templateId) missingVars.push('PAYWAY_TEMPLATE_ID');
    if (missingVars.length > 0) {
      return res.status(500).json({
        error: 'Faltan variables de entorno en Vercel',
        detail: `No están configuradas (o están vacías): ${missingVars.join(', ')}.`
      });
    }

    const siteTransactionId = `${userId || 'user'}_${Date.now()}`.slice(0, 40);
    const baseUrl = 'https://www.ressetia.com/app';
    const endpoint = ambient === 'production' ? ENDPOINT_PRODUCTION : ENDPOINT_SANDBOX;

    // Estructura CONFIRMADA de Payway: "site" es un objeto, con "template"
    // ANIDADO adentro — no un campo suelto "template_id" como probamos antes.
    const body = {
      site_transaction_id: siteTransactionId,
      payment_description: `Suscripción Ressetia - Plan ${plan === 'mensual' ? 'Mensual' : 'Anual'}`,
      currency: 'ARS',
      total_price: amount,
      installments: [1],
      plan_gobierno: false,
      auth_3ds: true,
      site: {
        id: siteId,
        transaction_id: siteTransactionId,
        template: { id: parseInt(templateId, 10) }
      },
      success_url: `${baseUrl}/index.html?payway_status=success&plan=${plan}`,
      cancel_url: `${baseUrl}/index.html?payway_status=cancel`,
      notifications_url: `${baseUrl}/api/webhook-payway`,
      customer: { email: userEmail || undefined, id: userId || undefined }
    };

    const paywayResp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': privateKey,
        'public_key': publicKey
      },
      body: JSON.stringify(body)
    });

    const result = await paywayResp.json();

    if (!paywayResp.ok) {
      console.error('Payway rechazó el pedido:', JSON.stringify(result, null, 2));
      return res.status(500).json({
        error: 'Payway rechazó el pedido',
        detail: typeof result === 'object' ? JSON.stringify(result) : String(result)
      });
    }

    const paymentId = result.id || result.payment_id;
    if (!paymentId) {
      console.error('Payway no devolvió un payment_id, respuesta completa:', JSON.stringify(result, null, 2));
      return res.status(500).json({ error: 'Payway no devolvió un ID de pago', detail: JSON.stringify(result) });
    }

    const checkoutUrl = ambient === 'production'
      ? `https://live.decidir.com/web/checkout/${paymentId}`
      : `https://developers.decidir.com/web/checkout/${paymentId}`;

    return res.status(200).json({ checkoutUrl });
  } catch (error) {
    const detailText = error instanceof Error ? error.message : JSON.stringify(error);
    console.error('Error en Payway checkout:', detailText);
    return res.status(500).json({ error: 'No se pudo generar el link de pago', detail: detailText });
  }
}
