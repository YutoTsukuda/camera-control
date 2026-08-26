/**
 * Claude による設定提案。
 *
 * 構造化出力（output_config.format + zodOutputFormat）を使い、
 * スキーマに適合した JSON だけを受け取る。自由文をパースする箇所は無い。
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AdviceSchema, type Advice } from './schema.js';
import { SYSTEM_PROMPT, buildContextText, parseImagePayload, type AdvisorInput } from './prompt.js';

export class AdvisorUnavailableError extends Error {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AdvisorUnavailableError';
    this.cause = cause;
  }
}

export interface ClaudeAdvisorOptions {
  /** 既定は claude-opus-5。 */
  model?: string;
  /** 既定は 'medium'。屋外での応答速度を優先するなら 'low'。 */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  client?: Anthropic;
  /** リクエストのタイムアウト[ms]。撮影現場で待たされないよう既定は45秒。 */
  timeoutMs?: number;
}

export class ClaudeAdvisor {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: NonNullable<ClaudeAdvisorOptions['effort']>;
  private readonly timeoutMs: number;

  constructor(options: ClaudeAdvisorOptions = {}) {
    this.client =
      options.client ??
      new Anthropic({
        // APIキーは環境変数（ANTHROPIC_API_KEY）から解決する。
        // 端末側には置かず、必ずブリッジサーバ側に置くこと。
        maxRetries: 2,
      });
    this.model = options.model ?? 'claude-opus-5';
    this.effort = options.effort ?? 'medium';
    this.timeoutMs = options.timeoutMs ?? 45_000;
  }

  async advise(input: AdvisorInput): Promise<Advice> {
    const image = parseImagePayload(input.imageBase64);
    const content: Anthropic.ContentBlockParam[] = [];

    if (image) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType ?? 'image/jpeg',
          data: image.data,
        },
      });
    }
    content.push({ type: 'text', text: buildContextText(input) });

    let message;
    try {
      message = await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: 4096,
          // システムプロンプトはリクエスト間で不変なのでキャッシュさせる。
          // 画像を含む本文は毎回変わるため、キャッシュ境界より後ろに置く。
          system: [
            { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          ],
          messages: [{ role: 'user', content }],
          output_config: {
            effort: this.effort,
            format: zodOutputFormat(AdviceSchema),
          },
        },
        { timeout: this.timeoutMs },
      );
    } catch (error) {
      throw new AdvisorUnavailableError(this.describeError(error), error);
    }

    if (message.stop_reason === 'refusal') {
      throw new AdvisorUnavailableError('モデルが応答を拒否しました。');
    }
    if (!message.parsed_output) {
      throw new AdvisorUnavailableError('構造化出力の解析に失敗しました。');
    }
    return message.parsed_output;
  }

  /** エラーを撮影者に意味の通る日本語へ変換する（具体的なものから順に判定）。 */
  private describeError(error: unknown): string {
    if (error instanceof Anthropic.AuthenticationError) {
      return 'Claude API の認証に失敗しました。ANTHROPIC_API_KEY を確認してください。';
    }
    if (error instanceof Anthropic.RateLimitError) {
      return 'Claude API のレート制限に達しました。少し待って再試行してください。';
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return 'Claude API がタイムアウトしました。電波状況を確認してください。';
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return 'Claude API に接続できませんでした（オフラインの可能性があります）。';
    }
    if (error instanceof Anthropic.APIError) {
      return `Claude API がエラーを返しました (HTTP ${error.status ?? '不明'})。`;
    }
    return `Claude API の呼び出しに失敗しました: ${String(error)}`;
  }
}
