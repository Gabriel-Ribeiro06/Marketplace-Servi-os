/**
 * Tokens do design system "Eu Faço".
 * Fonte: docs/DESIGN_SYSTEM.md seção 2.
 * Contraste (WCAG AA >= 4,5:1) verificado por testes em contrast.test.ts.
 */

export const colors = {
  primary: '#0B5FFF',
  primaryDark: '#0842B8',
  success: '#167934',
  warning: '#995800',
  danger: '#C62828',
  text: '#1A1F2B',
  textMuted: '#566073',
  surface: '#FFFFFF',
  background: '#F5F7FA',
  border: '#D5DBE4',
  onPrimary: '#FFFFFF',
} as const;

export type ColorToken = keyof typeof colors;

/** Escala tipográfica: tamanho / altura de linha. Texto mínimo 14. */
export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  subtitle: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  caption: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
} as const;

/** Grade de 4. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  field: 8,
  card: 12,
  pill: 999,
} as const;

/** Área mínima de toque (dp) e espaço mínimo entre alvos. */
export const touch = {
  minSize: 48,
  minGap: 8,
} as const;
