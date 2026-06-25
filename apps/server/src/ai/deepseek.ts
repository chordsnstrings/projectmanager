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

export interface Readiness {
  ready: boolean;
  score: number; // 0..100
  missing: string[];
  questions: string[];
}

const RUBRIC: Record<string, string> = {
  programming:
    'A programming task is specified when it states: the outcome/goal, scope (what is in/out), acceptance criteria (how we know it is done), the relevant repo/area or data, and any constraints (deadline, tech, compatibility).',
  marketing:
    'A marketing task is specified when it states: the goal/outcome, the audience and channel(s), the deliverable and format, brand/voice constraints, and a deadline.',
};

/**
 * Judge whether a task description is specified enough to act on. Returns a
 * structured verdict (JSON mode) used as a soft gate before handoff/claim.
 */
export async function assessTaskReadiness(input: {
  title: string;
  description: string;
  teamKey: string | null;
}): Promise<Readiness> {
  if (!aiConfigured()) throw new AiError('ai_not_configured');
  const rubric = (input.teamKey && RUBRIC[input.teamKey]) || RUBRIC.programming;
  const system = `You are a strict but fair reviewer deciding whether a work task is specified clearly enough for someone to start without further questions.
${rubric}
Be conservative: only mark ready:false when real, important information is missing — not for minor polish. Respond with ONLY a JSON object:
{"ready": boolean, "score": 0-100, "missing": ["short gap", ...], "questions": ["clarifying question", ...]}
"score" is your confidence it is actionable (>=60 means ready). Keep "missing" and "questions" to at most 4 items each, each one short. No prose outside the JSON.`;
  const user = `Task title: ${input.title}\n\nDescription:\n${input.description}`;
  let res: Response;
  try {
    res = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        // Fast structured verdict — no chain-of-thought needed (and reasoning
        // tokens would otherwise eat the budget and truncate the JSON).
        thinking: { type: 'disabled' },
        stream: false,
      }),
    });
  } catch {
    throw new AiError('ai_unreachable');
  }
  if (!res.ok) throw new AiError('ai_request_failed', res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const rawContent = data?.choices?.[0]?.message?.content?.trim();
  if (!rawContent) throw new AiError('ai_empty_response');
  // Be tolerant: some models wrap JSON in ```code fences``` or add stray text.
  let raw = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) raw = brace[0];
  let parsed: Partial<Readiness>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiError('ai_bad_json');
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));
  return {
    ready: typeof parsed.ready === 'boolean' ? parsed.ready : score >= 60,
    score,
    missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 4).map(String) : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 4).map(String) : [],
  };
}
