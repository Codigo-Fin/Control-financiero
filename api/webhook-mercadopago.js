// /api/webhook-mercadopago.js
// Mercado Pago llama a esta URL automáticamente cuando cambia el estado de un pago.
// Si el pago está aprobado, activamos is_premium = true y calculamos hasta cuándo
// dura el acceso, según el plan elegido (mensual, anual o de por vida).

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
    const paymentId = req.body?.data?.id || req.query?.['data.id'] || req.query?.id;

    if (!paymentId) {
      return res.status(200).end();
    }

    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpResponse.json();

    if (payment.status === 'approved') {
      // external_reference viene como "userId|plan|dias"
      const [userId, plan, daysStr] = (payment.external_reference || '').split('|');
      const days = parseInt(daysStr, 10) || 30;

      if (userId) {
        let subscriptionEndsAt = null; // null = no vence nunca (plan vitalicio)
        if (days > 0) {
          const end = new Date();
          end.setDate(end.getDate() + days);
          subscriptionEndsAt = end.toISOString();
        }

        await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ is_premium: true, subscription_ends_at: subscriptionEndsAt })
        });
      }
    }

    return res.status(200).end();
  } catch (err) {
    console.error('Error en webhook Mercado Pago:', err.message);
    return res.status(200).end();
  }
}
