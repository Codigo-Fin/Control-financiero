// /api/create-subscription.js
// Crea una SUSCRIPCIÓN RECURRENTE real de Mercado Pago (se llama "Preapproval").
// A diferencia de un pago único, esto autoriza a Mercado Pago a cobrarle
// automáticamente a la persona cada mes (o cada año), sin que tenga que volver
// a pagar a mano.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { userId, userEmail, plan, price } = req.body;

  if (!userId || !userEmail || !price) {
    return res.status(400).json({ error: 'Faltan datos (userId, userEmail o price)' });
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel' });
  }

  const SITE_URL = process.env.SITE_URL || `https://${req.headers.host}`;

  // Mensual: se cobra cada 1 mes. Anual: se cobra cada 12 meses.
  const frequency = plan === 'anual' ? 12 : 1;
  const reason = plan === 'anual' ? 'Suscripción Anual - Control Financiero' : 'Suscripción Mensual - Control Financiero';

  try {
    const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        reason: reason,
        external_reference: userId,
        payer_email: userEmail,
        back_url: `${SITE_URL}/index.html`,
        auto_recurring: {
          frequency: frequency,
          frequency_type: 'months',
          transaction_amount: Number(price),
          currency_id: 'ARS'
        },
        status: 'pending'
      })
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Error de Mercado Pago al crear preapproval:', data);
      return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
    }

    // Guardamos el ID de la suscripción ya de una vez, para poder cancelarla después
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ mp_preapproval_id: data.id })
      });
    }

    return res.status(200).json({ init_point: data.init_point });
  } catch (err) {
    console.error('Error interno en create-subscription:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
