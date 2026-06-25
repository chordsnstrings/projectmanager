// DeepSeek client for turning a manager's task request into a clear, step-by-step
// plan the assignee can follow. OpenAI-compatible chat completions; non-thinking
// mode (fast/cheap) — this is a structuring task, not deep reasoning.
import { env } from '../env';

export function aiConfigured(): boolean {
  return Boolean(env.DEEPSEEK_API_KEY);
}

export class AiError extends Error {
  constructor(public code: string, public status?: number) {
    super(code);
  }
}

const SYSTEM = `You convert a manager's task request into a clear, step-by-step plan the assignee can follow without further questions.
Output GitHub-flavored markdown only, and keep it concise:
- One short sentence summarising the goal.
- A numbered list of concrete, ordered steps (each a single actionable instruction).
- A short "Done when:" checklist of acceptance criteria.
Do not invent requirements that aren't implied by the request. Do not add preamble, sign-off, or commentary. If the request is vague, make reasonable assumptions and note them briefly in the relevant step.`;

/** Generate a step-by-step plan (markdown) from a task title + description. */
export async function generateTaskPlan(input: { title: string; description: string }): Promise<string> {
  if (!aiConfigured()) throw new AiError('ai_not_configured');
  const user = `Task: ${input.title}\n\nDescription / request:\n${input.description}`;
  let res: Response;
  try {
    res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: 900,
        stream: false,
      }),
    });
  } catch (err) {
    throw new AiError('ai_unreachable');
  }
  if (!res.ok) {
    throw new AiError('ai_request_failed', res.status);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new AiError('ai_empty_response');
  return content.slice(0, 8000);
}
