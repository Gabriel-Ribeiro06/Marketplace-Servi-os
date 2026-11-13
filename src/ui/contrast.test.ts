import { contrastRatio } from './contrast';
import { colors, touch } from './tokens';

const AA_NORMAL_TEXT = 4.5;

describe('contrastRatio', () => {
  it('retorna 21 para preto sobre branco', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  });

  it('retorna 1 para cores iguais', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });

  it('rejeita cor inválida', () => {
    expect(() => contrastRatio('azul', '#FFFFFF')).toThrow();
  });
});

describe('design system: contraste WCAG AA (texto normal)', () => {
  const pairs: [string, string, string][] = [
    ['text sobre surface', colors.text, colors.surface],
    ['text sobre background', colors.text, colors.background],
    ['textMuted sobre surface', colors.textMuted, colors.surface],
    ['textMuted sobre background', colors.textMuted, colors.background],
    ['onPrimary sobre primary', colors.onPrimary, colors.primary],
    ['onPrimary sobre primaryDark', colors.onPrimary, colors.primaryDark],
    ['primary sobre surface (links)', colors.primary, colors.surface],
    ['success sobre surface', colors.success, colors.surface],
    ['warning sobre surface', colors.warning, colors.surface],
    ['danger sobre surface', colors.danger, colors.surface],
  ];

  it.each(pairs)('%s atinge 4,5:1', (_name: string, fg: string, bg: string) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe('design system: acessibilidade de toque', () => {
  it('área mínima de toque é 48dp', () => {
    expect(touch.minSize).toBeGreaterThanOrEqual(48);
  });
});
