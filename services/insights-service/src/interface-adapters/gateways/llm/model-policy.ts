/**
 * OpenCode Go: «contributor» models (gemini-*-contributor, muse-spark-*-contributor) are used to TRAIN, so they are never allowed,
 * even if someone puts them in the allow list. The default list covers the families with 0-day retention and no training.
 */
export const DEFAULT_ALLOWED_MODELS = ['glm-*', 'kimi-*', 'deepseek-*', 'qwen*', 'minimax-*', 'mimo-*', 'longcat-*', 'claude-haiku-*'];

export const isContributorModel = (model: string): boolean => /contributor/i.test(model);

const matches = (pattern: string, model: string): boolean => {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i');
  return re.test(model);
};

/** null when the model may be used; otherwise the reason. */
export function modelRejection(model: string, allowed: string[]): string | null {
  if (!model.trim()) return 'model is empty';
  if (isContributorModel(model)) return `model ${model} is a contributor model (its traffic is used for training)`;
  const list = allowed.filter((p) => !isContributorModel(p));
  if (list.length > 0 && !list.some((p) => matches(p, model))) return `model ${model} is not in OPENCODE_ALLOWED_MODELS`;
  return null;
}
