import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import {
  preflightGolden,
  uploadGoldenSet,
  type GoldenPreflightReport,
  type GoldenUploadResult,
} from "../../api";
import { Button } from "../ui/Button";
import { Label } from "../ui/Label";

export interface LoadedGolden {
  id: string;
  name: string;
  fileHash: string;
  itemCount: number;
  warnings: string[];
}

interface Props {
  disabled?: boolean;
  groups: Array<{ name: string; queries: string[] }>;
  repeats: number;
  retryInfra: boolean;
  stopOnCircuitBreaker: boolean;
  preflight: GoldenPreflightReport | null;
  golden: LoadedGolden | null;
  onGoldenChange: (golden: LoadedGolden | null) => void;
  onPreflight: (report: GoldenPreflightReport | null) => void;
  onRepeatsChange: (value: number) => void;
  onRetryInfraChange: (value: boolean) => void;
  onStopOnCircuitChange: (value: boolean) => void;
  onError: (message: string) => void;
}

export async function runGoldenPreflight(
  goldenSetId: string,
  groups: Array<{ name: string; queries: string[] }>,
): Promise<GoldenPreflightReport> {
  return preflightGolden({ goldenSetId, groups });
}

export function GoldenSetup({
  disabled,
  groups,
  repeats,
  retryInfra,
  stopOnCircuitBreaker,
  preflight,
  golden,
  onGoldenChange,
  onPreflight,
  onRepeatsChange,
  onRetryInfraChange,
  onStopOnCircuitChange,
  onError,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    setUploading(true);
    try {
      const text = await file.text();
      const content = JSON.parse(text) as unknown;
      const stored: GoldenUploadResult = await uploadGoldenSet({
        name: file.name.replace(/\.json$/i, ""),
        content,
      });
      if (stored.errors.length > 0 || !stored.id) {
        onGoldenChange(null);
        onPreflight(null);
        onError(stored.errors.join(" ") || "Golden file is invalid.");
        return;
      }
      const loaded = {
        id: stored.id,
        name: stored.name,
        fileHash: stored.fileHash,
        itemCount: stored.itemCount,
        warnings: stored.warnings,
      };
      onGoldenChange(loaded);
      onError("");
      if (groups.some((group) => group.queries.length > 0)) {
        onPreflight(await runGoldenPreflight(stored.id, groups));
      } else {
        onPreflight(null);
      }
    } catch (error) {
      onGoldenChange(null);
      onPreflight(null);
      onError(error instanceof Error ? error.message : "Golden upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Golden answer</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload the answer key next to the suite. Unmatched suite queries still run and are marked not scored.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled || uploading}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          Upload golden JSON
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>

      {golden && (
        <dl className="grid gap-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">File</dt>
            <dd className="font-medium text-foreground">{golden.name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">SHA-256</dt>
            <dd className="truncate font-mono" title={golden.fileHash}>
              {golden.fileHash.slice(0, 16)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Items</dt>
            <dd className="font-medium text-foreground">{golden.itemCount}</dd>
          </div>
        </dl>
      )}
      {golden && golden.warnings.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground">
          {golden.warnings.slice(0, 8).map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {preflight?.agentSchema && (
        <p className="text-xs text-muted-foreground">
          Agent schema context: hash {preflight.agentSchema.schemaHash ?? "not loaded"},{" "}
          {preflight.agentSchema.tables} tables, {preflight.agentSchema.enumColumns} enum columns
          {preflight.agentSchema.builtAt
            ? `, built ${new Date(preflight.agentSchema.builtAt).toLocaleString()}`
            : ""}
          .
        </p>
      )}

      {preflight && (
        <div className="grid gap-2 sm:grid-cols-2">
          {preflight.checks.map((check) => (
            <div key={check.id} className="rounded-md border border-border px-3 py-2 text-xs">
              <p className="font-medium capitalize text-foreground">
                {check.id} · {check.status}
              </p>
              <p className="mt-1 text-muted-foreground">{check.messages[0]}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <Label htmlFor="golden-repeats">Repeats</Label>
          <input
            id="golden-repeats"
            type="number"
            min={1}
            max={5}
            value={repeats}
            disabled={disabled}
            className="mt-1 h-9 w-20 rounded-md border border-input bg-background px-2 text-sm"
            onChange={(event) => {
              const value = Number(event.target.value);
              onRepeatsChange(Math.min(5, Math.max(1, Number.isFinite(value) ? value : 1)));
            }}
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={retryInfra}
            disabled={disabled}
            onChange={(event) => onRetryInfraChange(event.target.checked)}
          />
          Retry infrastructure errors
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={stopOnCircuitBreaker}
            disabled={disabled}
            onChange={(event) => onStopOnCircuitChange(event.target.checked)}
          />
          Stop after 5 infrastructure errors
        </label>
      </div>
    </div>
  );
}
