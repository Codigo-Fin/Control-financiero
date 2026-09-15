// api/payway-checkout.js
//
// Genera un link de pago con Payway (Formulario de Pago / VentaOnline) para que
// el usuario pague con tarjeta sin pasar por Mercado Pago.
//
// Variables de entorno necesarias en Vercel (Settings → Environment Variables):
//   PAYWAY_PRIVATE_KEY   -> secreta, nunca se expone al navegador
//   PAYWAY_PUBLIC_KEY    -> tu clave pública
//   PAYWAY_SITE_ID       -> tu Site ID
//   PAYWAY_TEMPLATE_ID   -> tu Template ID
//   PAYWAY_AMBIENT       -> "developer" (pruebas) o "production" (cuando lances)

import sdkModulo from 'sdk-node-payway';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { plan, userEmail, userId } = req.body;

    if (!plan || !['mensual', 'anual'].includes(plan)) {
      return res.status(400).json({ error: 'Plan inválido' });
    }

    const PRICES = {
      mensual: 6999,
      anual: 69990,
    };
    const amount = PRICES[plan];

    const ambient = process.env.PAYWAY_AMBIENT || 'developer';
    const publicKey = process.env.PAYWAY_PUBLIC_KEY;
    const privateKey = process.env.PAYWAY_PRIVATE_KEY;
    const siteId = process.env.PAYWAY_SITE_ID;
    const templateId = process.env.PAYWAY_TEMPLATE_ID;

    // Si falta cualquiera de estas variables en Vercel, avisamos clarito de
    // entrada — así no perdemos tiempo interpretando una respuesta confusa
    // de Payway cuando en realidad el dato nunca le llegó.
    const missingVars = [];
    if (!publicKey) missingVars.push('PAYWAY_PUBLIC_KEY');
    if (!privateKey) missingVars.push('PAYWAY_PRIVATE_KEY');
    if (!siteId) missingVars.push('PAYWAY_SITE_ID');
    if (!templateId) missingVars.push('PAYWAY_TEMPLATE_ID');
    if (missingVars.length > 0) {
      return res.status(500).json({
        error: 'Faltan variables de entorno en Vercel',
        detail: `No están configuradas (o están vacías): ${missingVars.join(', ')}. Revisá Vercel → Settings → Environment Variables.`
      });
    }

    const sdk = new sdkModulo.sdk(ambient, publicKey, privateKey, 'Ressetia', userEmail || 'usuario');

    const siteTransactionId = `${userId || 'user'}_${Date.now()}`.slice(0, 40);
    const baseUrl = 'https://www.ressetia.com/app';

    const args = {
      origin_platform: 'Ressetia-Web',
      payment_description: `Suscripción Ressetia - Plan ${plan === 'mensual' ? 'Mensual' : 'Anual'}`,
      currency: 'ARS',
      total_price: amount,
      site: siteId,
      success_url: `${baseUrl}/index.html?payway_status=success&plan=${plan}`,
      cancel_url: `${baseUrl}/index.html?payway_status=cancel`,
      notifications_url: `${baseUrl}/api/webhook-payway`,
      template_id: parseInt(templateId, 10),
      installments: [1],
      plan_gobierno: false,
      public_apikey: publicKey,
      auth_3ds: true,
      site_transaction_id: siteTransactionId,
    };

    // sdk.checkout() es el único método real (confirmado en el código fuente del
    // SDK) — genera el link de pago en un solo paso, y usa callback, no promesa,
    // así que lo envolvemos en una Promise para poder usar await como el resto
    // del código.
    const result = await new Promise((resolve, reject) => {
      sdk.checkout(args, (result, err) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    const paymentId = result.id || result.payment_id;
    if (!paymentId) {
      console.error('Payway no devolvió un payment_id, respuesta completa:', result);
      return res.status(500).json({ error: 'Payway no devolvió un ID de pago', detail: result });
    }

    const checkoutUrl = ambient === 'production'
      ? `https://live.decidir.com/web/checkout/${paymentId}`
      : `https://developers.decidir.com/web/checkout/${paymentId}`;

    return res.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('Error en Payway checkout:', error);
    // Serializamos bien el detalle del error de Payway — si es un objeto (lo más
    // común con esta SDK), lo convertimos a texto legible en vez de perderlo como
    // "[object Object]".
    const detailText = error instanceof Error
      ? error.message
      : (typeof error === 'object' ? JSON.stringify(error) : String(error));
    console.error('Error en Payway checkout (detalle completo):', JSON.stringify(error, null, 2));
    return res.status(500).json({ error: 'No se pudo generar el link de pago', detail: detailText });
  }
}
