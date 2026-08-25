// api/get-stock-price.js
// Consulta el precio actual de una acción de EE.UU. (NASDAQ/NYSE) usando Finnhub.
// No cubre CEDEARs argentinos (bolsa de Buenos Aires) — para esos se usa Google Finance manual.

export default async function handler(req, res) {
  const { ticker } = req.query || {};
  if (!ticker) {
    return res.status(400).json({ error: 'Falta el ticker' });
  }

  const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
  if (!FINNHUB_API_KEY) {
    return res.status(500).json({ error: 'Falta configurar FINNHUB_API_KEY' });
  }

  try {
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`);
    const data = await response.json();

    if (!response.ok || !data || typeof data.c !== 'number' || data.c === 0) {
      return res.status(404).json({ error: 'No se encontró precio para ese ticker' });
    }

    return res.status(200).json({ price: data.c, previousClose: data.pc });
  } catch (err) {
    console.error('Error al consultar Finnhub:', err.message);
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
