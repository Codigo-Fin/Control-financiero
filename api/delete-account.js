// api/delete-account.js
// Borra la cuenta y TODOS los datos de la persona, de forma permanente.
// Requisito obligatorio de Apple/Google para aprobar la app en las tiendas.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'Falta el ID de usuario' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tqbfggzcmfnsobggmyuk.supabase.co';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Falta configuración del servidor' });
  }

  const adminHeaders = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    // 1) Borramos primero todos los datos de las tablas (transacciones, config,
    //    libertad financiera) — si algo de esto falla, no seguimos borrando la cuenta.
    const tablesToClean = ['transactions', 'user_settings', 'libertad_financiera_data'];
    for (const table of tablesToClean) {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers: adminHeaders
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`Error borrando la tabla ${table}:`, errText);
        return res.status(500).json({ error: `No se pudo borrar la tabla ${table}` });
      }
    }

    // 2) Recién ahora, borramos la cuenta de autenticación en sí (requiere la clave
    //    de servicio — esto NUNCA se puede hacer desde el navegador con la clave pública).
    const deleteUserResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: adminHeaders
    });

    if (!deleteUserResp.ok) {
      const errText = await deleteUserResp.text();
      console.error('Error borrando el usuario:', errText);
      return res.status(500).json({ error: 'Se borraron los datos, pero no se pudo borrar la cuenta de acceso. Contactanos.' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error general al eliminar la cuenta:', err);
    return res.status(500).json({ error: 'Error interno al eliminar la cuenta' });
  }
}
