// /api/cancel-subscription.js
// Cuando alguien se da de baja, esto le avisa a Mercado Pago que cancele
// la suscripción recurrente, para que deje de cobrarle automáticamente.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: 'Falta userId' });
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de entorno' });
  }

  try {
    // 1. Buscamos el ID de la suscripción de este usuario
    const getResp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=mp_preapproval_id`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const rows = await getResp.json();
    const preapprovalId = rows?.[0]?.mp_preapproval_id;

    // 2. Si existe, le avisamos a Mercado Pago que la cancele
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

    // 3. Desactivamos el premium en nuestra base, ya mismo (no esperamos al webhook)
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

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error al cancelar suscripción:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
