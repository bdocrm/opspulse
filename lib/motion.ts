/** Shared OpsView motion tokens. Millisecond values mirror the CSS custom properties. */
export const motionDuration = {
  micro: 140,
  interaction: 180,
  component: 240,
  card: 300,
  section: 360,
  count: 800,
} as const;

export const motionEase = {
  standard: "cubic-bezier(0.22, 1, 0.36, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

export const motionDistance = {
  xs: 3,
  sm: 6,
  md: 8,
  drawer: 24,
} as const;

export const motionClass = {
  page: "motion-page-enter",
  fadeIn: "motion-fade-in",
  fadeUp: "motion-fade-up",
  fadeDown: "motion-fade-down",
  fadeLeft: "motion-fade-left",
  fadeRight: "motion-fade-right",
  scaleIn: "motion-scale-in",
  card: "motion-card-enter",
  staggerContainer: "motion-stagger",
  staggerItem: "motion-stagger-item",
  hoverLift: "motion-hover-lift",
  statusReveal: "motion-status-reveal",
  errorReveal: "motion-error-reveal",
  emptyState: "motion-empty-state",
} as const;
