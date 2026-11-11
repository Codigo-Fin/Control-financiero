// api/_auth.js
// Helper compartido (el "_" adelante hace que Vercel NO lo cuente como función
// serverless aparte, así no suma al límite de 12 del plan Hobby).
//
// Verifica el token de sesión de Supabase que manda el navegador en el header
// "Authorization: Bearer <token>" y devuelve el usuario REAL dueño de ese token.
// Así el servidor nunca confía en un "userId" que venga en el body: antes,
// cualquiera que supiera el ID de otra persona podía borrarle la cuenta o
// cancelarle la suscripción.

export async function getAuthUser(req) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user?.id ? user : null;
  } catch (err) {
    console.error('Error al verificar la sesión:', err.message);
    return null;
  }
}

// Devuelve el usuario o responde 401 directamente (y devuelve null).
export async function requireAuth(req, res) {
  const user = await getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Sesión inválida o vencida. Volvé a iniciar sesión.' });
    return null;
  }
  return user;
}

// Lee el estado de acceso de la persona (con la clave de servicio).
export async function getAccess(userId) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !KEY) return null;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}&select=is_premium,subscription_ends_at,trial_ends_at,lifetime_access`, {
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` }
  });
  if (!resp.ok) return null;
  const row = (await resp.json())?.[0] || {};
  const now = new Date();
  const subscriptionActive = row.is_premium === true &&
    (!row.subscription_ends_at || new Date(row.subscription_ends_at) > now);
  const trialActive = !!row.trial_ends_at && new Date(row.trial_ends_at) > now;
  return {
    subscriptionActive,
    trialActive,
    lifetimeBasic: row.lifetime_access === true,
    // La IA es solo del plan con suscripción (o durante la prueba gratis).
    // El plan Básico de por vida (bono del ebook) NO incluye IA.
    aiAllowed: subscriptionActive || trialActive
  };
}

// Usuario logueado + con IA habilitada; si no, responde 401/403 y devuelve null.
export async function requireAiAccess(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  const access = await getAccess(user.id);
  if (!access?.aiAllowed) {
    res.status(403).json({
      error: 'Esta función usa Inteligencia Artificial y es parte del plan Premium con IA.',
      code: 'AI_REQUIRES_PREMIUM'
    });
    return null;
  }
  return user;
}

// Precios oficiales: los define SOLO el servidor. Antes el precio venía del
// navegador y cualquiera podía mandarse "price: 1" y suscribirse por $1.
export const PLAN_PRICES = {
  mensual: 6999,
  anual: 69000
};

// Precio mensual exclusivo de la IA para quienes compraron el ebook (tienen lifetime_access).
// Se puede cambiar sin tocar código con EBOOK_AI_MONTHLY_PRICE en Vercel.
export const EBOOK_AI_MONTHLY_PRICE = Number(process.env.EBOOK_AI_MONTHLY_PRICE || 4999);
