import type { AgentEvent, GraphNodeName } from "../types/agentEvents";
import { nodeStreamLabel } from "./agentStreamLabels";

/** Nodes that stream markdown — hide step UI once they start. */
const STREAM_OUTPUT_NODES = new Set<GraphNodeName>([
  "formatResponse",
  "answer",
]);

export interface StreamProgressState {
  /** Single status line — replaced on each node, never accumulated. */
  currentLabel: string | null;
  /** Gap after a node completes, before the next one starts. */
  thinking: boolean;
  /** When false, chat shows only streaming markdown. */
  showProgress: boolean;
  validationWarning: string | null;
  streaming: boolean;
}

export function initialStreamProgress(): StreamProgressState {
  return {
    currentLabel: null,
    thinking: false,
    showProgress: true,
    validationWarning: null,
    streaming: true,
  };
}

export function shouldShowStreamProgress(
  state: StreamProgressState | undefined,
): boolean {
  if (!state?.showProgress) return false;
  return state.thinking || Boolean(state.currentLabel) || Boolean(state.validationWarning);
}

function isStreamOutputNode(node: GraphNodeName): boolean {
  return STREAM_OUTPUT_NODES.has(node);
}

function enterStreamingPhase(state: StreamProgressState): StreamProgressState {
  return {
    ...state,
    showProgress: false,
    currentLabel: null,
    thinking: false,
    validationWarning: null,
  };
}

export function applyAgentEvent(
  state: StreamProgressState,
  event: AgentEvent,
): StreamProgressState {
  switch (event.type) {
    case "node_start": {
      if (isStreamOutputNode(event.node)) {
        return enterStreamingPhase(state);
      }
      return {
        ...state,
        showProgress: true,
        currentLabel: nodeStreamLabel(event.node),
        thinking: false,
        validationWarning: null,
      };
    }
    case "node_complete": {
      if (isStreamOutputNode(event.node)) {
        return enterStreamingPhase(state);
      }
      return {
        ...state,
        currentLabel: null,
        thinking: true,
      };
    }
    case "status":
      return {
        ...state,
        showProgress: true,
        currentLabel: event.message,
        thinking: false,
      };
    case "validation_failed":
      return {
        ...state,
        showProgress: true,
        validationWarning:
          event.errors[0] ?? "Validation failed — retrying",
        thinking: false,
      };
    case "token":
      return enterStreamingPhase(state);
    case "done":
      return { ...enterStreamingPhase(state), streaming: false };
    case "error":
      return { ...state, streaming: false, thinking: false };
    default:
      return state;
  }
}
