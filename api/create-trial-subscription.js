// /api/create-trial-subscription.js
// Igual que create-subscription.js, pero pensado para el momento del registro:
// la persona autoriza su medio de pago YA, pero Mercado Pago no le cobra nada
// hasta que pasen los 14 días de prueba gratis (usamos "start_date" para eso).

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

  const frequency = plan === 'anual' ? 12 : 1;
  const reason = plan === 'anual' ? 'Suscripción Anual - Control Financiero' : 'Suscripción Mensual - Control Financiero';

  // El primer cobro se programa recién dentro de 14 días (fin de la prueba gratis)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 14);

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
          currency_id: 'ARS',
          start_date: startDate.toISOString()
        },
        status: 'pending'
      })
    });

    const data = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Error de Mercado Pago al crear preapproval de prueba:', data);
      return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
    }

    // Guardamos el ID y el plan de una vez (el webhook lo confirma después cuando se autorice)
    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ mp_preapproval_id: data.id, current_plan: plan || 'mensual' })
      });
    }

    return res.status(200).json({ init_point: data.init_point });
  } catch (err) {
    console.error('Error interno en create-trial-subscription:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
