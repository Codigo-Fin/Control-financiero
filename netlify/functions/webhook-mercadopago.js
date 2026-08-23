// netlify/functions/webhook-mercadopago.js
// Mercado Pago llama a esta URL automáticamente cuando cambia el estado de una
// SUSCRIPCIÓN RECURRENTE (Preapproval): cuando se autoriza, se cancela, o falla un cobro.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: '' };
  }

  const query = event.queryStringParameters || {};
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    body = {};
  }

  console.log('Webhook recibido. Query:', JSON.stringify(query), 'Body:', JSON.stringify(body));

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan variables de entorno');
    return { statusCode: 500, body: '' };
  }

  try {
    const notificationType = body?.type || query?.topic;
    const preapprovalId = body?.data?.id || query?.['data.id'] || query?.id;

    console.log('Tipo de notificación:', notificationType, '| ID:', preapprovalId);

    if (!preapprovalId) {
      return { statusCode: 200, body: '' };
    }

    if (notificationType && notificationType.includes('authorized_payment')) {
      console.log('Notificación de cobro recurrente individual, se ignora (el estado real lo da la preapproval).');
      return { statusCode: 200, body: '' };
    }

    const mpResponse = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const preapproval = await mpResponse.json();

    console.log('Estado de la suscripción:', preapproval.status, '| external_reference:', preapproval.external_reference);

    if (!mpResponse.ok) {
      console.error('Error al consultar la preapproval en Mercado Pago:', preapproval);
      return { statusCode: 200, body: '' };
    }

    const userId = preapproval.external_reference;
    if (!userId) {
      console.error('La preapproval no tiene external_reference');
      return { statusCode: 200, body: '' };
    }

    let isPremium = null;
    if (preapproval.status === 'authorized') {
      isPremium = true;
    } else if (preapproval.status === 'cancelled' || preapproval.status === 'paused') {
      isPremium = false;
    }

    if (isPremium !== null) {
      const detectedPlan = preapproval.auto_recurring?.frequency === 12 ? 'anual' : 'mensual';
      const updateResp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ is_premium: isPremium, mp_preapproval_id: preapprovalId, current_plan: isPremium ? detectedPlan : null })
      });
      const updateResult = await updateResp.json();
      console.log('Resultado de actualizar user_settings:', updateResp.status, JSON.stringify(updateResult));
    }

    return { statusCode: 200, body: '' };
  } catch (err) {
    console.error('Error en webhook Mercado Pago:', err.message, err.stack);
    return { statusCode: 200, body: '' };
  }
};
