// netlify/functions/cancel-subscription.js
// Cuando alguien se da de baja, esto le avisa a Mercado Pago que cancele
// la suscripción recurrente, para que deje de cobrarle automáticamente.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  const { userId } = JSON.parse(event.body || '{}');
  if (!userId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Falta userId' }) };
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Faltan variables de entorno' }) };
  }

  try {
    const getResp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=mp_preapproval_id`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const rows = await getResp.json();
    const preapprovalId = rows?.[0]?.mp_preapproval_id;

    if (preapprovalId) {
      await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ status: 'cancelled' })
      });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ is_premium: false })
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Error al cancelar suscripción:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Error interno', detail: err.message }) };
  }
};
