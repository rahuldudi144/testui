import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardPaste, Download, Upload } from "lucide-react";
import {
  downloadWorkflowTestExample,
  parseWorkflowTestJsonText,
  WORKFLOW_TEST_JSON_EXAMPLE,
  type ParsedWorkflowTestImport,
} from "../../lib/parseWorkflowTestJson";
import { countQueriesInGroups } from "../../lib/parseQueryGroups";
import { Button } from "../ui/Button";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";
import { cn } from "../../lib/cn";

interface Props {
  disabled?: boolean;
  onImport: (data: ParsedWorkflowTestImport) => void;
  onError: (message: string) => void;
}

export function WorkflowTestJsonImport({ disabled, onImport, onError }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [pastedJson, setPastedJson] = useState("");

  function applyJsonText(text: string) {
    setImportMessage(null);
    const trimmed = text.trim();
    if (!trimmed) {
      onError("Paste JSON or upload a file first.");
      return;
    }

    const result = parseWorkflowTestJsonText(trimmed);
    if (!result.ok) {
      onError(result.error);
      return;
    }

    onImport(result.data);
    setImportMessage(
      `Loaded "${result.data.testName}" with ${result.data.groups.length} group(s) and ${countQueriesInGroups(result.data.groups)} queries.`,
    );
  }

  async function handleFile(file: File) {
    const text = await file.text();
    applyJsonText(text);
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Import from JSON</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste JSON below or upload a file to fill the test name, groups, and
            queries. Optional{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              dryRun
            </code>{" "}
            and{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
              delayMs
            </code>{" "}
            are applied when present.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={downloadWorkflowTestExample}
          >
            <Download className="h-4 w-4" />
            Download example
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Upload JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="workflow-test-json-paste">Paste JSON</Label>
        <Textarea
          id="workflow-test-json-paste"
          value={pastedJson}
          onChange={(e) => setPastedJson(e.target.value)}
          placeholder='{ "testName": "My test", "groups": [...] }'
          className="min-h-[140px] font-mono text-xs"
          disabled={disabled}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled || !pastedJson.trim()}
            onClick={() => applyJsonText(pastedJson)}
          >
            <ClipboardPaste className="h-4 w-4" />
            Apply pasted JSON
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => setPastedJson("")}
          >
            Clear
          </Button>
        </div>
      </div>

      {importMessage && (
        <p className="text-xs text-success">{importMessage}</p>
      )}

      <button
        type="button"
        onClick={() => setFormatOpen((open) => !open)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-ring rounded-sm"
      >
        {formatOpen ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        JSON format reference
      </button>

      {formatOpen && (
        <pre
          className={cn(
            "max-h-72 overflow-auto rounded-md border border-border bg-muted/20 p-3",
            "font-mono text-[11px] leading-relaxed text-muted-foreground",
          )}
        >
          {JSON.stringify(WORKFLOW_TEST_JSON_EXAMPLE, null, 2)}
        </pre>
      )}
    </div>
  );
}
