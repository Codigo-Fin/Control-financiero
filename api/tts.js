// api/tts.js
// Voz neuronal (suena como una persona real) para el botón "Escuchar" del asistente.
// Usa Azure Speech con la voz argentina "es-AR-ElenaNeural" (mujer).
//
// Para activarla: crear un recurso "Speech" gratis en portal.azure.com y cargar en
// Vercel las variables AZURE_SPEECH_KEY y AZURE_SPEECH_REGION (ej: "eastus").
// Opcional: AZURE_SPEECH_VOICE para usar otra voz.
// Mientras no estén cargadas, responde 501 y la app usa la mejor voz del celular.
import { requireAiAccess } from './_auth.js';

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const KEY = process.env.AZURE_SPEECH_KEY;
  const REGION = process.env.AZURE_SPEECH_REGION;
  if (!KEY || !REGION) {
    return res.status(501).json({ error: 'La voz natural todavía no está configurada', code: 'TTS_NOT_CONFIGURED' });
  }

  // Es parte del plan con IA (y así nadie de afuera gasta el cupo de la voz)
  const user = await requireAiAccess(req, res);
  if (!user) return;

  const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  if (!text) return res.status(400).json({ error: 'Falta el texto' });

  const voice = process.env.AZURE_SPEECH_VOICE || 'es-AR-ElenaNeural';
  const ssml = `<speak version="1.0" xml:lang="es-AR"><voice name="${voice}"><prosody rate="0%">${escapeXml(text)}</prosody></voice></speak>`;

  try {
    const resp = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ressetia'
      },
      body: ssml
    });
    if (!resp.ok) {
      console.error('Error de Azure TTS:', resp.status, await resp.text());
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
