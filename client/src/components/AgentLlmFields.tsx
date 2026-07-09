import type { LlmProvider } from "../api";
import {
  baseUrlFieldMeta,
  listProviderOptions,
  modelPlaceholder,
  providerShowsApiKey,
} from "../lib/llmProviders";
import { FormField } from "./ui/FormField";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";

interface Props {
  idPrefix: string;
  provider: LlmProvider;
  onProviderChange: (value: LlmProvider) => void;
  modelName: string;
  onModelNameChange: (value: string) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  hasStoredApiKey?: boolean;
  disabled?: boolean;
}

export function AgentLlmFields({
  idPrefix,
  provider,
  onProviderChange,
  modelName,
  onModelNameChange,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  hasStoredApiKey,
  disabled,
}: Props) {
  const options = listProviderOptions();
  const baseUrlMeta = baseUrlFieldMeta(provider);
  const groups = [...new Set(options.map((option) => option.group))];

  return (
    <div className="space-y-4">
      <FormField>
        <Label htmlFor={`${idPrefix}-provider`}>LLM provider</Label>
        <select
          id={`${idPrefix}-provider`}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={provider}
          disabled={disabled}
          onChange={(e) => onProviderChange(e.target.value as LlmProvider)}
        >
          {groups.map((group) => (
            <optgroup key={group} label={group}>
              {options
                .filter((option) => option.group === group)
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </FormField>

      <FormField>
        <Label htmlFor={`${idPrefix}-model`}>Model name</Label>
        <Input
          id={`${idPrefix}-model`}
          value={modelName}
          disabled={disabled}
          placeholder={modelPlaceholder(provider)}
          onChange={(e) => onModelNameChange(e.target.value)}
        />
      </FormField>

      {providerShowsApiKey(provider) && (
        <FormField>
          <Label htmlFor={`${idPrefix}-api-key`}>API key</Label>
          <Input
            id={`${idPrefix}-api-key`}
            type="password"
            value={apiKey}
            disabled={disabled}
            placeholder={hasStoredApiKey ? "Leave blank to keep existing key" : "sk-..."}
            onChange={(e) => onApiKeyChange(e.target.value)}
          />
        </FormField>
      )}

      <FormField>
        <Label htmlFor={`${idPrefix}-base-url`}>{baseUrlMeta.label}</Label>
        <Input
          id={`${idPrefix}-base-url`}
          value={baseUrl}
          disabled={disabled}
          placeholder={baseUrlMeta.placeholder}
          onChange={(e) => onBaseUrlChange(e.target.value)}
        />
        {baseUrlMeta.hint && (
          <p className="mt-1 text-xs text-muted-foreground">{baseUrlMeta.hint}</p>
        )}
      </FormField>
    </div>
  );
}
