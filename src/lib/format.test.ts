import { formatCentsToBRL, formatDateTimeBR, parseBRLToCents } from './format';

describe('formatCentsToBRL / parseBRLToCents', () => {
  it('formata centavos em reais (pt-BR)', () => {
    expect(formatCentsToBRL(0).replace(/\s/g, ' ')).toBe('R$ 0,00');
    expect(formatCentsToBRL(15050).replace(/\s/g, ' ')).toBe('R$ 150,50');
  });

  it('rejeita centavos negativos ou fracionários', () => {
    expect(() => formatCentsToBRL(-10)).toThrow();
    expect(() => formatCentsToBRL(10.5)).toThrow();
  });

  it('converte string em reais para centavos inteiros', () => {
    expect(parseBRLToCents('R$ 1.250,90')).toBe(125090);
    expect(parseBRLToCents('80,00')).toBe(8000);
    expect(parseBRLToCents('80')).toBe(8000);
  });

  it('rejeita string monetária inválida', () => {
    expect(() => parseBRLToCents('abc')).toThrow();
    expect(() => parseBRLToCents('-10,00')).toThrow();
  });
});

describe('formatDateTimeBR (fuso America/Sao_Paulo)', () => {
  it('formata timestamp UTC no horário de São Paulo (UTC-3)', () => {
    // 15:30 UTC = 12:30 em America/Sao_Paulo
    const formatted = formatDateTimeBR('2026-11-13T15:30:00.000Z');
    expect(formatted).toContain('13/11/2026');
    expect(formatted).toContain('12:30');
  });

  it('rejeita data inválida', () => {
    expect(() => formatDateTimeBR('data-invalida')).toThrow();
  });
});
