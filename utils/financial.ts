// Módulo de utilidades financieras para evitar errores de centavos
export const toCents = (amount: number): number => {
  return Math.round(amount * 100);
};

export const fromCents = (cents: number): number => {
  return cents / 100;
};

export const formatCurrency = (amount: number, currency = 'ARS'): string => {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
  }).format(amount);
};
