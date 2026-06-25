import { AgentProfileSettings } from "./AgentProfileSettings";

interface Props {
  onAgentChange?: () => void;
}

export function AgentSettings({ onAgentChange }: Props) {
  return <AgentProfileSettings onAgentChange={onAgentChange} />;
}
