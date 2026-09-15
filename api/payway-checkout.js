// api/payway-checkout.js
//
// Genera un link de pago con Payway (Formulario de Pago / VentaOnline) para que
// el usuario pague con tarjeta sin pasar por Mercado Pago.
//
// Variables de entorno necesarias en Vercel (Settings → Environment Variables):
//   PAYWAY_PRIVATE_KEY   -> secreta, nunca se expone al navegador
//   PAYWAY_PUBLIC_KEY    -> KiMOUA5xWtyqjhd3YTboWPodKwsXdakW
//   PAYWAY_SITE_ID       -> 93019057
//   PAYWAY_TEMPLATE_ID   -> 42247
//   PAYWAY_AMBIENT       -> "developer" (pruebas) o "production" (cuando lances)

const sdkModulo = require('sdk-node-payway');

module.exports = async (req, res) => {
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

    const sdk = new sdkModulo.sdk(ambient, publicKey, privateKey, 'Ressetia', userEmail || 'usuario');

    // El transaction_id tiene que ser único por operación — usamos el userId + fecha
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

    // Paso 1: generar el hash de la operación
    const checkout = new sdk.checkoutHash(sdk, args);
    const hashResult = await checkout;

    // Paso 2: con el hash, pedimos el link de pago hosteado por Payway.
    // NOTA: el nombre exacto de este método SDK ("paymentLink" / "getLink" / etc.)
    // hay que confirmarlo la primera vez que se pruebe en sandbox — la
    // documentación pública no mostraba este paso completo. Si el nombre real
    // es distinto, Payway devuelve un error claro indicando el método correcto.
    const linkResult = await sdk.paymentLink({ hash: hashResult.hash, ...args });

    const paymentId = linkResult.id || linkResult.payment_id;
    const checkoutUrl = ambient === 'production'
      ? `https://live.decidir.com/web/checkout/${paymentId}`
      : `https://developers.decidir.com/web/checkout/${paymentId}`;

    return res.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('Error en Payway checkout:', error);
    return res.status(500).json({ error: 'No se pudo generar el link de pago', detail: error.message });
  }
};
