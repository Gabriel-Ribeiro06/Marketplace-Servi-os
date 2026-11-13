/**
 * Funções puras de formatação (DATABASE.md e TEST_STRATEGY.md seção 4):
 * - Valores monetários sempre trafegam em centavos (integer) e são exibidos em BRL (R$).
 * - Datas exibidas no fuso de negócio America/Sao_Paulo.
 */

export const BUSINESS_TIMEZONE = 'America/Sao_Paulo';

export function formatCentsToBRL(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw new Error('O valor em centavos deve ser um inteiro não negativo.');
  }
  const reais = cents / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(reais);
}

export function parseBRLToCents(input: string): number {
  const normalized = input.replace(/[R$\s.]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Valor monetário inválido.');
  }
  return Math.round(Number(normalized) * 100);
}

export function formatDateTimeBR(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(date.getTime())) {
    throw new Error('Data inválida.');
  }
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
