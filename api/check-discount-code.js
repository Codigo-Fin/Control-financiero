// api/check-discount-code.js
// Verifica si un código de descuento sigue vigente (sin gastar un uso todavía —
// el uso real se descuenta recién cuando se crea la suscripción de verdad).

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ valid: false, error: 'Falta el código' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ valid: false, error: 'Falta configuración del servidor' });
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/discount_codes?code=eq.${encodeURIComponent(code.toUpperCase())}&select=*`, {
      headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    });
    const rows = await resp.json();
    const row = rows?.[0];

    if (!row) {
      return res.status(200).json({ valid: false, error: 'Ese código no existe' });
    }
    if (row.used_count >= row.max_uses) {
      return res.status(200).json({ valid: false, error: 'Ese código ya alcanzó el límite de usos' });
    }

    return res.status(200).json({ valid: true, discountPct: row.discount_pct });
  } catch (err) {
    console.error('Error al verificar código de descuento:', err.message);
    return res.status(500).json({ valid: false, error: 'Error interno' });
  }
}
