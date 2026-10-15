export const DEFAULT_REPORT_HIDE_THRESHOLD = 3;

/** RN-10.1: hide when the number of OPEN reports from distinct reporters reaches the threshold. */
export function shouldAutoHide(openReportsCount: number, threshold: number): boolean {
  return openReportsCount >= threshold;
}
