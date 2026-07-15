import type { LlmProvider } from "../api";
import type { EmbeddingProvider } from "../lib/llmProviders";
import {
  baseUrlFieldMeta,
  embeddingBaseUrlFieldMeta,
  embeddingModelPlaceholder,
  embeddingProviderShowsApiKey,
  listEmbeddingProviderOptions,
  listProviderOptions,
  modelPlaceholder,
  providerShowsApiKey,
} from "../lib/llmProviders";
import { FormField } from "./ui/FormField";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";

export interface AgentLlmFieldLabels {
  provider?: string;
  model?: string;
  apiKey?: string;
}

interface Props {
  idPrefix: string;
  provider: LlmProvider | EmbeddingProvider | "";
  onProviderChange: (value: string) => void;
  modelName: string;
  onModelNameChange: (value: string) => void;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  baseUrl: string;
  onBaseUrlChange: (value: string) => void;
  hasStoredApiKey?: boolean;
  disabled?: boolean;
  /** Defaults to chat LLM labels. */
  labels?: AgentLlmFieldLabels;
  /**
   * When true, provider may be empty ("Use chat / server default").
   * Used for optional embedding config.
   */
  allowEmptyProvider?: boolean;
  emptyProviderLabel?: string;
  /**
   * Embedding mode: OpenAI / Local / Ollama / Gemini only,
   * with embedding model placeholders and field rules.
   */
  embeddingMode?: boolean;
}

const DEFAULT_LABELS: Required<AgentLlmFieldLabels> = {
  provider: "LLM provider",
  model: "Model name",
  apiKey: "API key",
};

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
  labels,
  allowEmptyProvider,
  emptyProviderLabel = "Use chat / server default",
  embeddingMode,
}: Props) {
  const resolvedLabels = { ...DEFAULT_LABELS, ...labels };

  if (embeddingMode) {
    const embeddingOptions = listEmbeddingProviderOptions();
    const effectiveProvider = (provider || "openai") as EmbeddingProvider;
    const baseUrlMeta = embeddingBaseUrlFieldMeta(effectiveProvider);
    const showApiKey =
      Boolean(provider) &&
      embeddingProviderShowsApiKey(provider as EmbeddingProvider);

    return (
      <div className="space-y-4">
        <FormField>
          <Label htmlFor={`${idPrefix}-provider`}>
            {resolvedLabels.provider}
          </Label>
          <select
            id={`${idPrefix}-provider`}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={provider}
            disabled={disabled}
            onChange={(e) => onProviderChange(e.target.value)}
        >
          {allowEmptyProvider && (
            <option value="">{emptyProviderLabel}</option>
          )}
          {embeddingOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FormField>

      {provider ? (
        <>
          <FormField>
            <Label htmlFor={`${idPrefix}-model`}>
              {resolvedLabels.model}
            </Label>
            <Input
              id={`${idPrefix}-model`}
              value={modelName}
              disabled={disabled}
              placeholder={embeddingModelPlaceholder(
                provider as EmbeddingProvider,
              )}
              onChange={(e) => onModelNameChange(e.target.value)}
            />
          </FormField>

          {showApiKey && (
            <FormField>
              <Label htmlFor={`${idPrefix}-api-key`}>
                {resolvedLabels.apiKey}
              </Label>
              <Input
                id={`${idPrefix}-api-key`}
                type="password"
                value={apiKey}
                disabled={disabled}
                placeholder={
                  hasStoredApiKey
                    ? "Leave blank to keep existing key"
                    : "Optional — falls back to chat API key"
                }
                onChange={(e) => onApiKeyChange(e.target.value)}
              />
            </FormField>
          )}

          {provider !== "gemini" && (
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
                <p className="mt-1 text-xs text-muted-foreground">
                  {baseUrlMeta.hint}
                </p>
              )}
            </FormField>
          )}
        </>
      ) : null}
    </div>
  );
  }

  const options = listProviderOptions();
  const effectiveProvider = (provider || "openai") as LlmProvider;
  const baseUrlMeta = baseUrlFieldMeta(effectiveProvider);
  const groups = [...new Set(options.map((option) => option.group))];
  const showApiKey = !provider
    ? false
    : providerShowsApiKey(provider as LlmProvider);

  return (
    <div className="space-y-4">
      <FormField>
        <Label htmlFor={`${idPrefix}-provider`}>{resolvedLabels.provider}</Label>
        <select
          id={`${idPrefix}-provider`}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={provider}
          disabled={disabled}
          onChange={(e) => onProviderChange(e.target.value)}
        >
          {allowEmptyProvider && (
            <option value="">{emptyProviderLabel}</option>
          )}
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

      {provider ? (
        <>
          <FormField>
            <Label htmlFor={`${idPrefix}-model`}>{resolvedLabels.model}</Label>
            <Input
              id={`${idPrefix}-model`}
              value={modelName}
              disabled={disabled}
              placeholder={modelPlaceholder(effectiveProvider)}
              onChange={(e) => onModelNameChange(e.target.value)}
            />
          </FormField>

          {showApiKey && (
            <FormField>
              <Label htmlFor={`${idPrefix}-api-key`}>
                {resolvedLabels.apiKey}
              </Label>
              <Input
                id={`${idPrefix}-api-key`}
                type="password"
                value={apiKey}
                disabled={disabled}
                placeholder={
                  hasStoredApiKey ? "Leave blank to keep existing key" : "sk-..."
                }
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
              <p className="mt-1 text-xs text-muted-foreground">
                {baseUrlMeta.hint}
              </p>
            )}
          </FormField>
        </>
      ) : null}
    </div>
  );
}
