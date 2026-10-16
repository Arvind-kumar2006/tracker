import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#0F1115',
  surface: '#181B22',
  surfaceAlt: '#1F232C',
  border: '#2A2F3A',
  text: '#ECEFF4',
  textMuted: '#8B93A1',
  primary: '#6C5CE7',
  primarySoft: '#8B7CF6',
  primaryTint: '#29254B',
  positive: '#00B894',
  positiveTint: '#153A34',
  warning: '#FDCB6E',
  warningTint: '#3E3420',
  negative: '#FF7675',
  negativeTint: '#3E2428',
  neutral: '#B2BEC3',
  white: '#FFFFFF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 40 };

export const radius = { sm: 6, md: 10, lg: 16, xl: 22, pill: 999 };

export const typography = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700', color: colors.text, letterSpacing: -0.25 },
  h2: { fontSize: 19, lineHeight: 25, fontWeight: '600', color: colors.text },
  h3: { fontSize: 15, lineHeight: 20, fontWeight: '600', color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  small: { fontSize: 12, lineHeight: 18, color: colors.textMuted },
  tiny: { fontSize: 10, lineHeight: 14, color: colors.textMuted, letterSpacing: 0.35 },
  mono: { fontSize: 11, lineHeight: 16, color: colors.textMuted, fontFamily: 'Menlo' },
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
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  heroCard: {
    backgroundColor: colors.primaryTint,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#49427E',
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  sectionTitle: { ...typography.h2, marginBottom: spacing.sm, marginTop: spacing.lg },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 14,
    minHeight: 48,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    minHeight: 28,
    justifyContent: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: { backgroundColor: colors.border, borderColor: colors.border, opacity: 0.7 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  buttonGhost: { backgroundColor: 'transparent', minHeight: 44, paddingHorizontal: spacing.sm },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  buttonSecondaryText: { color: colors.primarySoft, fontWeight: '700', fontSize: 14 },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    height: 68,
    paddingTop: 8,
    paddingBottom: 8,
  },
});

export const toneColor = (tone) =>
  ({ positive: colors.positive, warning: colors.warning, negative: colors.negative, neutral: colors.neutral })[tone] ??
  colors.neutral;
