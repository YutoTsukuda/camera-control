/**
 * 設定提案のエントリポイント。
 *
 * Claude を第一候補にし、失敗したらルールベースへ自動フォールバックする。
 * 撮影現場では「提案が出ない」が最悪の結果なので、
 * 何らかの提案を必ず返すことをこの層の契約にしている。
 */
import { ClaudeAdvisor, AdvisorUnavailableError, type ClaudeAdvisorOptions } from './advisor.js';
import { adviseByRules } from './rules.js';
import { composeProposal } from './compose.js';
import type { AdvisorInput } from './prompt.js';
import type { SettingsProposal } from '../domain/types.js';

export { AdvisorUnavailableError, ClaudeAdvisor } from './advisor.js';
export { adviseByRules } from './rules.js';
export { composeProposal } from './compose.js';
export type { AdvisorInput } from './prompt.js';
export type { Advice } from './schema.js';

export interface AdviseOptions extends ClaudeAdvisorOptions {
  /** true にすると Claude を呼ばずルールベースのみを使う（オフラインモード）。 */
  offline?: boolean;
  /** 差し替え可能な advisor（テスト用）。 */
  advisor?: Pick<ClaudeAdvisor, 'advise'>;
}

export interface AdviseResult extends SettingsProposal {
  /** Claude が使えずフォールバックした場合の理由。 */
  fallbackReason?: string;
}

export async function adviseSettings(
  input: AdvisorInput,
  options: AdviseOptions = {},
): Promise<AdviseResult> {
  if (!options.offline) {
    const advisor = options.advisor ?? new ClaudeAdvisor(options);
    try {
      const advice = await advisor.advise(input);
      return composeProposal(advice, input, 'claude');
    } catch (error) {
      const reason =
        error instanceof AdvisorUnavailableError
          ? error.message
          : `想定外のエラー: ${String(error)}`;
      const proposal = composeProposal(adviseByRules(input), input, 'rules');
      return { ...proposal, fallbackReason: reason };
    }
  }
  return composeProposal(adviseByRules(input), input, 'rules');
}
