// /api/create-preference.js
// Crea un "link de pago" (preferencia) de Mercado Pago para un usuario específico.
// El front-end llama a esta función y lo redirige al link que devuelve.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { userId, userEmail } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Falta userId' });
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel' });
  }

  // URL pública de tu sitio (para el webhook y las URLs de retorno)
  const SITE_URL = process.env.SITE_URL || `https://${req.headers.host}`;

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
            title: 'Suscripción Premium - Control Financiero',
            quantity: 1,
            unit_price: 3100, // <-- CAMBIÁ ESTE MONTO por el precio real de tu suscripción
            currency_id: 'ARS'
          }
        ],
        payer: { email: userEmail || undefined },
        external_reference: userId, // esto es lo que nos permite saber QUIÉN pagó
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
