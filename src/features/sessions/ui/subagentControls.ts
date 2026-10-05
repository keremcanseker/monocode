import { createContext } from "react";

/**
 * What a subagent row may do to its own run. Provided by the session pane for
 * harnesses that can stop a single subagent; rows elsewhere get nothing.
 */
export type SubagentControlsValue = {
  stop?: (callId: string) => Promise<boolean>;
};

export const SubagentControls = createContext<SubagentControlsValue>({});

/** The row asked to open itself, and a nonce so asking twice still lands. */
export const SubagentReveal = createContext<{
  id: string;
  nonce: number;
} | null>(null);
