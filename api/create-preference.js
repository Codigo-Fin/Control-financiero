// /api/create-preference.js
// Crea un "link de pago" (preferencia) de Mercado Pago para un usuario específico,
// según el plan elegido (mensual, anual o de por vida).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { userId, userEmail, plan, price, days } = req.body;

  if (!userId || !price) {
    return res.status(400).json({ error: 'Faltan datos (userId o price)' });
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel' });
  }

  const SITE_URL = process.env.SITE_URL || `https://${req.headers.host}`;

  const planLabels = { mensual: 'Suscripción Mensual', anual: 'Suscripción Anual', vitalicio: 'Suscripción de por Vida' };
  const title = planLabels[plan] || 'Suscripción Premium - Control Financiero';

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [
          {
            title: title,
            quantity: 1,
            unit_price: Number(price),
            currency_id: 'ARS'
          }
        ],
        payer: { email: userEmail || undefined },
        // Guardamos el plan y la duración junto al userId, separados por "|",
        // para que el webhook sepa cuántos días de acceso activar.
        external_reference: `${userId}|${plan || 'mensual'}|${days || 30}`,
        back_urls: {
          success: `${SITE_URL}/index.html`,
          failure: `${SITE_URL}/index.html`,
          pending: `${SITE_URL}/index.html`
        },
        auto_return: 'approved',
        notification_url: `${SITE_URL}/api/webhook-mercadopago`
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
    }

    return res.status(200).json({ init_point: data.init_point });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
