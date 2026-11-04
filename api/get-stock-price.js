// api/get-stock-price.js
// Precios actuales para la cartera de inversiones.
//
//   GET /api/get-stock-price?tickers=GOOGL,AAPL&market=BCBA   → CEDEARs / acciones argentinas, en PESOS
//   GET /api/get-stock-price?tickers=GOOGL&market=US          → acciones de EE.UU., en DÓLARES
//   (también acepta ?ticker=GOOGL, como antes)
//
// BCBA: primero data912 (lista completa de CEDEARs y acciones del Merval, gratis y sin
// clave) y, si un ticker no aparece, Yahoo Finance (GOOGL.BA). US: Finnhub.
// Son datos públicos: no hace falta sesión. Vercel guarda la respuesta 5 minutos.

const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;

async function fetchJson(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function argentinePrices(tickers) {
  const out = {};
  const [cedears, stocks] = await Promise.all([
    fetchJson('https://data912.com/live/arg_cedears'),
    fetchJson('https://data912.com/live/arg_stocks')
  ]);
  const bySymbol = {};
  [...(Array.isArray(cedears) ? cedears : []), ...(Array.isArray(stocks) ? stocks : [])].forEach((row) => {
    if (row && row.symbol && typeof row.c === 'number' && row.c > 0) bySymbol[row.symbol.toUpperCase()] = row;
  });

  for (const t of tickers) {
    const row = bySymbol[t];
    if (row) {
      out[t] = { price: row.c, changePct: typeof row.pct_change === 'number' ? row.pct_change : null, currency: 'ARS', source: 'data912' };
    }
  }

  // Lo que no apareció, lo buscamos en Yahoo (TICKER.BA)
  const missing = tickers.filter((t) => !out[t]);
  await Promise.all(missing.map(async (t) => {
    const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}.BA?interval=1d&range=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const meta = data?.chart?.result?.[0]?.meta;
    if (meta && typeof meta.regularMarketPrice === 'number' && meta.regularMarketPrice > 0) {
      out[t] = { price: meta.regularMarketPrice, changePct: meta.regularMarketChangePercent ?? null, currency: 'ARS', source: 'yahoo' };
    }
  }));
  return out;
}

async function usPrices(tickers) {
  const out = {};
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return out;
  await Promise.all(tickers.map(async (t) => {
    const data = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t)}&token=${key}`);
    if (data && typeof data.c === 'number' && data.c > 0) {
      out[t] = { price: data.c, changePct: typeof data.dp === 'number' ? data.dp : null, currency: 'USD', source: 'finnhub' };
    }
  }));
  return out;
}

export default async function handler(req, res) {
  const raw = String(req.query?.tickers || req.query?.ticker || '');
  const tickers = [...new Set(raw.split(',').map((t) => t.trim().toUpperCase()).filter((t) => TICKER_RE.test(t)))].slice(0, 30);
  if (tickers.length === 0) {
    return res.status(400).json({ error: 'Falta el ticker' });
  }
  const market = String(req.query?.market || 'BCBA').toUpperCase() === 'US' ? 'US' : 'BCBA';

  try {
    const prices = market === 'US' ? await usPrices(tickers) : await argentinePrices(tickers);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    // Compatibilidad con el formato viejo (un solo ticker)
    if (req.query?.ticker && !req.query?.tickers) {
      const p = prices[tickers[0]];
      if (!p) return res.status(404).json({ error: 'No se encontró precio para ese ticker' });
      return res.status(200).json({ price: p.price, changePct: p.changePct, currency: p.currency });
    }
    return res.status(200).json({ market, prices, updatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('Error al consultar precios:', err.message);
    return res.status(500).json({ error: 'Error interno' });
  }
}
