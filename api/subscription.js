// /api/subscription.js
// Unifica en un solo archivo lo que antes eran 4 funciones separadas:
// create-subscription, cancel-subscription, change-plan, create-trial-subscription.
// Esto es puramente para bajar la cantidad de funciones serverless (Vercel Hobby
// permite máximo 12) — la lógica de cada una es EXACTAMENTE la misma que antes,
// solo que ahora conviven en un mismo archivo, elegidas por el campo "action".

async function applyDiscountIfValid(discountCode, price, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) {
  if (!discountCode || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { finalPrice: price, codeUsed: null };

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/discount_codes?code=eq.${encodeURIComponent(discountCode.toUpperCase())}&select=*`, {
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await resp.json();
  const row = rows?.[0];

  if (!row || row.used_count >= row.max_uses) {
    return { finalPrice: price, codeUsed: null };
  }

  const finalPrice = Math.round(price * (1 - row.discount_pct / 100));

  await fetch(`${SUPABASE_URL}/rest/v1/discount_codes?code=eq.${encodeURIComponent(discountCode.toUpperCase())}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ used_count: row.used_count + 1 })
  });

  return { finalPrice, codeUsed: row.code };
}

async function handleCreate(req, res, { MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL }) {
  const { userId, userEmail, plan, price } = req.body;
  if (!userId || !userEmail || !price) {
    return res.status(400).json({ error: 'Faltan datos (userId, userEmail o price)' });
  }

  const frequency = plan === 'anual' ? 12 : 1;
  const reason = plan === 'anual' ? 'Suscripción Anual - Control Financiero' : 'Suscripción Mensual - Control Financiero';

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      reason, external_reference: userId, payer_email: userEmail,
      back_url: `${SITE_URL}/index.html`,
      notification_url: `${SITE_URL}/api/webhook-mercadopago`,
      auto_recurring: { frequency, frequency_type: 'months', transaction_amount: Number(price), currency_id: 'ARS' },
      status: 'pending'
    })
  });
  const data = await mpResponse.json();
  if (!mpResponse.ok) {
    console.error('Error de Mercado Pago al crear preapproval:', data);
    return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
  }

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ mp_preapproval_id: data.id, current_plan: plan })
    });
  }
  return res.status(200).json({ init_point: data.init_point });
}

async function handleCreateTrial(req, res, { MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL }) {
  const { userId, userEmail, plan, price, discountCode } = req.body;
  if (!userId || !userEmail || !price) {
    return res.status(400).json({ error: 'Faltan datos (userId, userEmail o price)' });
  }

  const frequency = plan === 'anual' ? 12 : 1;
  const reason = plan === 'anual' ? 'Suscripción Anual - Ressetia' : 'Suscripción Mensual - Ressetia';
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 14);

  const { finalPrice, codeUsed } = await applyDiscountIfValid(discountCode, price, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      reason: codeUsed ? `${reason} (código ${codeUsed})` : reason,
      external_reference: userId, payer_email: userEmail,
      back_url: `${SITE_URL}/index.html`,
      notification_url: `${SITE_URL}/api/webhook-mercadopago`,
      auto_recurring: { frequency, frequency_type: 'months', transaction_amount: Number(finalPrice), currency_id: 'ARS', start_date: startDate.toISOString() },
      status: 'pending'
    })
  });
  const data = await mpResponse.json();
  if (!mpResponse.ok) {
    console.error('Error de Mercado Pago al crear preapproval de prueba:', data);
    return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
  }

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ mp_preapproval_id: data.id, current_plan: plan || 'mensual' })
    });
  }
  return res.status(200).json({ init_point: data.init_point });
}

async function handleCancel(req, res, { MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }) {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'Falta userId' });

  const getResp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=mp_preapproval_id`, {
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await getResp.json();
  const preapprovalId = rows?.[0]?.mp_preapproval_id;

  if (preapprovalId) {
    await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ is_premium: false })
  });

  return res.status(200).json({ ok: true });
}

async function handleChangePlan(req, res, { MP_ACCESS_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL }) {
  const { userId, userEmail, newPlan, newPrice } = req.body;
  if (!userId || !userEmail || !newPlan || !newPrice) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const getResp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=mp_preapproval_id`, {
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const rows = await getResp.json();
  const oldPreapprovalId = rows?.[0]?.mp_preapproval_id;

  if (oldPreapprovalId) {
    await fetch(`https://api.mercadopago.com/preapproval/${oldPreapprovalId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
      body: JSON.stringify({ status: 'cancelled' })
    });
  }

  const frequency = newPlan === 'anual' ? 12 : 1;
  const reason = newPlan === 'anual' ? 'Suscripción Anual - Control Financiero' : 'Suscripción Mensual - Control Financiero';

  const mpResponse = await fetch('https://api.mercadopago.com/preapproval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      reason, external_reference: userId, payer_email: userEmail,
      back_url: `${SITE_URL}/index.html`,
      notification_url: `${SITE_URL}/api/webhook-mercadopago`,
      auto_recurring: { frequency, frequency_type: 'months', transaction_amount: Number(newPrice), currency_id: 'ARS' },
      status: 'pending'
    })
  });
  const data = await mpResponse.json();
  if (!mpResponse.ok) {
    console.error('Error al crear la nueva preapproval:', data);
    return res.status(500).json({ error: 'Error de Mercado Pago', detail: data });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ mp_preapproval_id: data.id, current_plan: newPlan })
  });

  return res.status(200).json({ init_point: data.init_point });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    let parsedBody = req.body;
    if (typeof parsedBody === 'string') {
      try { parsedBody = JSON.parse(parsedBody); } catch { parsedBody = {}; }
    }
    req.body = parsedBody || {};
    const { action } = req.body;
    const env = {
      MP_ACCESS_TOKEN: process.env.MP_ACCESS_TOKEN,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      SITE_URL: process.env.SITE_URL || `https://${req.headers.host}`
    };

    if (!env.MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel' });
    }

    switch (action) {
      case 'create': return await handleCreate(req, res, env);
      case 'create-trial': return await handleCreateTrial(req, res, env);
      case 'cancel': return await handleCancel(req, res, env);
      case 'change-plan': return await handleChangePlan(req, res, env);
      default: return res.status(400).json({ error: 'action inválida (usar: create, create-trial, cancel, change-plan)', detail: `Recibido: ${JSON.stringify(action)}` });
    }
  } catch (err) {
    console.error(`Error interno en subscription:`, err.message, err.stack);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
