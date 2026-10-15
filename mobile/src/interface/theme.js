import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#0F1115',
  surface: '#181B22',
  surfaceAlt: '#1F232C',
  border: '#2A2F3A',
  text: '#ECEFF4',
  textMuted: '#8B93A1',
  primary: '#6C5CE7',
  positive: '#00B894',
  warning: '#FDCB6E',
  negative: '#FF7675',
  neutral: '#B2BEC3',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };

export const typography = {
  h1: { fontSize: 26, fontWeight: '700', color: colors.text },
  h2: { fontSize: 19, fontWeight: '600', color: colors.text },
  h3: { fontSize: 15, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 12, color: colors.textMuted },
  tiny: { fontSize: 11, color: colors.textMuted },
  mono: { fontSize: 11, color: colors.textMuted, fontFamily: 'Menlo' },
};

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  sectionTitle: { ...typography.h2, marginBottom: spacing.sm, marginTop: spacing.lg },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: colors.border },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
});

export const toneColor = (tone) =>
  ({ positive: colors.positive, warning: colors.warning, negative: colors.negative, neutral: colors.neutral })[tone] ??
  colors.neutral;