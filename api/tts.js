// api/tts.js
// Voz humana para el botón "Escuchar" del asistente, con ElevenLabs.
//
// Variables en Vercel:
//   ELEVENLABS_API_KEY   (obligatoria)
//   ELEVENLABS_VOICE_ID  (obligatoria: la voz elegida en la Voice Library)
//   ELEVENLABS_MODEL     (opcional, por defecto eleven_flash_v2_5: gasta la mitad de créditos)
//   TTS_DAILY_LIMIT      (opcional, escuchas por persona por día, por defecto 10)
// Mientras no estén cargadas, responde 501 y la app usa la mejor voz del celular.
import { requireAiAccess } from './_auth.js';

const DEFAULT_DAILY_LIMIT = 10;

// Cuenta la escucha del día (el dueño no tiene límite). -1 = llegó al límite.
async function consumeDailyQuota(userId, chars, limit) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tts_consume`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user: userId, p_chars: chars, p_limit: limit })
  });
  if (!resp.ok) {
    // Si falla el contador no cortamos la voz: solo lo dejamos registrado
    console.error('Error al contar el uso de voz:', resp.status, await resp.text());
    return 0;
  }
  return await resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const API_KEY = process.env.ELEVENLABS_API_KEY;
  const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
  if (!API_KEY || !VOICE_ID) {
    return res.status(501).json({ error: 'La voz natural todavía no está configurada', code: 'TTS_NOT_CONFIGURED' });
  }

  // Es parte del plan con IA (y así nadie de afuera gasta el cupo de la voz)
  const user = await requireAiAccess(req, res);
  if (!user) return;

  const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2500);
  if (!text) return res.status(400).json({ error: 'Falta el texto' });

  const limit = parseInt(process.env.TTS_DAILY_LIMIT, 10) || DEFAULT_DAILY_LIMIT;
  const used = await consumeDailyQuota(user.id, text.length, limit);
  if (used === -1) {
    return res.status(429).json({ error: 'Llegaste al límite de escuchas con voz natural de hoy', code: 'TTS_DAILY_LIMIT' });
  }

  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(VOICE_ID)}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5',
        language_code: 'es',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true }
      })
    });
    if (!resp.ok) {
      console.error('Error de ElevenLabs:', resp.status, await resp.text());
      return res.status(502).json({ error: 'No se pudo generar la voz' });
    }
    const audio = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(audio);
  } catch (err) {
    console.error('Error interno en TTS:', err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}
