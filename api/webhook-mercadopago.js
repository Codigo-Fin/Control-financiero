// /api/webhook-mercadopago.js
// Mercado Pago llama a esta URL automáticamente cuando cambia el estado de un pago.
// Si el pago está aprobado, activamos is_premium = true para ese usuario en Supabase.

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).end();
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan variables de entorno');
    return res.status(500).end();
  }

  try {
    // Mercado Pago manda el id del pago en distintos formatos según el tipo de notificación
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

    if (!paymentId) {
      // Puede ser una notificación de prueba o de otro tipo; respondemos OK para que MP no reintente en loop
      return res.status(200).end();
    }

    // 1. Consultamos el pago real a Mercado Pago (nunca confiamos ciegamente en el webhook)
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpResponse.json();

    if (payment.status === 'approved') {
      const userId = payment.external_reference;

      if (userId) {
        // 2. Activamos is_premium = true para ese usuario en Supabase, usando la Service Role Key
        //    (esta clave tiene permisos totales, por eso solo se usa acá, del lado del servidor, nunca en el navegador)
        await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ is_premium: true })
        });
      }
    }

    return res.status(200).end();
  } catch (err) {
    console.error('Error en webhook Mercado Pago:', err.message);
    return res.status(200).end(); // respondemos 200 igual para que MP no reintente infinito
  }
}
