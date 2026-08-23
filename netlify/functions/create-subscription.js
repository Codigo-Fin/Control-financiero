// netlify/functions/create-subscription.js
// Crea una SUSCRIPCIÓN RECURRENTE real de Mercado Pago (se llama "Preapproval").
// A diferencia de un pago único, esto autoriza a Mercado Pago a cobrarle
// automáticamente a la persona cada mes (o cada año), sin que tenga que volver
// a pagar a mano.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const { userId, userEmail, plan, price } = JSON.parse(event.body || '{}');

  if (!userId || !userEmail || !price) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos (userId, userEmail o price)' }) };
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta configurar MP_ACCESS_TOKEN en Netlify' }) };
  }

  const SITE_URL = process.env.SITE_URL || `https://${event.headers.host}`;

  const frequency = plan === 'anual' ? 12 : 1;
  const reason = plan === 'anual' ? 'Suscripción Anual - Finzia' : 'Suscripción Mensual - Finzia';

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
        notification_url: `${SITE_URL}/api/webhook-mercadopago`,
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
      return { statusCode: 500, body: JSON.stringify({ error: 'Error de Mercado Pago', detail: data }) };
    }

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ mp_preapproval_id: data.id, current_plan: plan })
      });
    }

    return { statusCode: 200, body: JSON.stringify({ init_point: data.init_point }) };
  } catch (err) {
    console.error('Error interno en create-subscription:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno', detail: err.message }) };
  }
};
