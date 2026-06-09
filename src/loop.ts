import { BigentAgent } from "./agent.js";

export type LoopRunOptions = {
  maxTurns?: number;
  onProgress?: (event: LoopProgressEvent) => void | Promise<void>;
};

export type LoopRunResult = {
  answer: string;
  turns: number;
  status: "done" | "blocked" | "stopped";
};

export type LoopProgressEvent =
  | { stage: "start"; turn: number; maxTurns: number; prompt: string }
  | { stage: "before_turn"; turn: number; maxTurns: number }
  | { stage: "after_turn"; turn: number; maxTurns: number; status: "done" | "blocked" | "continue"; answer: string }
  | { stage: "stopped"; turn: number; maxTurns: number; answer: string }
  | { stage: "done"; turn: number; maxTurns: number; answer: string }
  | { stage: "blocked"; turn: number; maxTurns: number; answer: string };

const LOOP_SYSTEM_PROMPT = `Loop mode rules:
- Treat the request as an executable work queue, not a one-shot chat reply.
- Do not refuse because the task is large if it is otherwise legitimate and allowed.
- Break large work into the smallest useful chunk, complete that chunk, and continue.
- If you need more turns, end the response with a single control line: [[CONTINUE]].
- If you are done, end the response with a single control line: [[DONE]].
- If you are truly blocked by missing information or a real constraint, end with a single control line: [[BLOCKED: reason]].
- Do not repeat the control line anywhere else.
- Keep the actual answer concise and operational.
`;

export async function runLoopedPrompt(agent: BigentAgent, prompt: string, options: LoopRunOptions = {}): Promise<LoopRunResult> {
  const maxTurns = Math.max(1, options.maxTurns ?? 30);
  const notify = async (event: LoopProgressEvent): Promise<void> => {
    await options.onProgress?.(event);
  };
  let currentPrompt = prompt;
  let lastAnswer = "";
  let turns = 0;

  await notify({ stage: "start", turn: 0, maxTurns, prompt });

  for (let turn = 0; turn < maxTurns; turn += 1) {
    turns = turn + 1;
    await notify({ stage: "before_turn", turn: turns, maxTurns });
    const response = await agent.prompt(currentPrompt, { extraSystemPrompt: LOOP_SYSTEM_PROMPT });
    const parsed = parseLoopResponse(response);
    lastAnswer = parsed.answer;
    await notify({ stage: "after_turn", turn: turns, maxTurns, status: parsed.status === "continue" ? "continue" : parsed.status, answer: lastAnswer });

    if (parsed.status === "done") {
      await notify({ stage: "done", turn: turns, maxTurns, answer: lastAnswer });
      return { answer: lastAnswer, turns, status: "done" };
    }

    if (parsed.status === "blocked") {
      await notify({ stage: "blocked", turn: turns, maxTurns, answer: lastAnswer });
      return { answer: lastAnswer, turns, status: "blocked" };
    }

    currentPrompt = [
      "Continue the same task from the previous turn.",
      "Do not repeat already completed work.",
      "Pick up from the current state and advance the work by the next useful chunk.",
      "",
      `Previous turn output:\n${lastAnswer}`,
    ].join("\n");
  }

  await notify({ stage: "stopped", turn: turns, maxTurns, answer: lastAnswer });
  return { answer: lastAnswer, turns, status: "stopped" };
}

function parseLoopResponse(text: string): { status: "done" | "blocked" | "continue"; answer: string } {
  const normalized = text.trim();
  const blocked = normalized.match(/\[\[BLOCKED:\s*([\s\S]*?)\s*\]\]\s*$/i);
  if (blocked) {
    return {
      status: "blocked",
      answer: stripMarker(normalized, blocked[0]).trim(),
    };
  }

  if (/\[\[CONTINUE\]\]\s*$/i.test(normalized)) {
    return {
      status: "continue",
      answer: stripMarker(normalized, "[[CONTINUE]]").trim(),
    };
  }

  if (/\[\[DONE\]\]\s*$/i.test(normalized)) {
    return {
      status: "done",
      answer: stripMarker(normalized, "[[DONE]]").trim(),
    };
  }

  return { status: "done", answer: normalized };
}

function stripMarker(text: string, marker: string): string {
  return text
    .replace(new RegExp(`\\s*${escapeRegExp(marker)}\\s*$`, "i"), "")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
