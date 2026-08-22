// /api/change-plan.js
// Permite cambiar de plan (ej. de Mensual a Anual): cancela la suscripción
// recurrente actual en Mercado Pago y crea una nueva con el plan elegido.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { userId, userEmail, newPlan, newPrice } = req.body;

  if (!userId || !userEmail || !newPlan || !newPrice) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de entorno' });
  }

  const SITE_URL = process.env.SITE_URL || `https://${req.headers.host}`;

  try {
    // 1. Buscamos la suscripción actual del usuario
    const getResp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=mp_preapproval_id`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const rows = await getResp.json();
    const oldPreapprovalId = rows?.[0]?.mp_preapproval_id;

    // 2. Cancelamos la suscripción vieja en Mercado Pago (si existe)
    if (oldPreapprovalId) {
      await fetch(`https://api.mercadopago.com/preapproval/${oldPreapprovalId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        },
        body: JSON.stringify({ status: 'cancelled' })
      });
    }

    // 3. Creamos la nueva suscripción con el plan elegido
    const frequency = newPlan === 'anual' ? 12 : 1;
    const reason = newPlan === 'anual' ? 'Suscripción Anual - Control Financiero' : 'Suscripción Mensual - Control Financiero';

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
          transaction_amount: Number(newPrice),
          currency_id: 'ARS'
        },
        status: 'pending'
      })
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Error al crear la nueva preapproval:', data);
      return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
    }

    // 4. Guardamos el ID nuevo y el plan (is_premium sigue en true, no se corta el acceso)
    await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ mp_preapproval_id: data.id, current_plan: newPlan })
    });

    return res.status(200).json({ init_point: data.init_point });
  } catch (err) {
    console.error('Error en change-plan:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
