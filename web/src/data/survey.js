// SPHEREx survey calendar. Science operations began 2025-05-01 and each
// all-sky pass takes about six months.
export const SURVEY_START_MJD = 60796; // 2025-05-01
export const SURVEY_PERIOD = 182.6; // days per all-sky pass

export function surveyLabel(n) {
  return n === 0 ? 'Commissioning' : `Survey ${n}`;
}

export function surveyColorVar(n) {
  return n === 0 ? 'var(--text-3)' : `var(--survey-${Math.min(3, n)})`;
}
