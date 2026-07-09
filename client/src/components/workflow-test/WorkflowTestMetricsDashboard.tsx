import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WorkflowTestCompletePayload } from "../../api";
import {
  buildCompareMetrics,
  buildRunMetrics,
  type CompareMetrics,
  type RunMetrics,
} from "../../lib/workflowTestMetrics";
import { InspectSection } from "./InspectBlocks";

const CHART_COLORS = {
  passed: "hsl(142 76% 36%)",
  failed: "hsl(0 84% 60%)",
  errors: "hsl(0 72% 50%)",
  plannerSkipped: "hsl(215 16% 47%)",
  primary: "hsl(var(--primary))",
  muted: "hsl(var(--muted-foreground))",
  secondary: "hsl(217 91% 60%)",
  accent: "hsl(38 92% 50%)",
};

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function formatDelta(value: number, suffix = ""): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}${suffix}`;
}

function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {delta !== undefined && (
        <p
          className={
            delta > 0
              ? "mt-0.5 text-xs text-amber-600 dark:text-amber-400"
              : delta < 0
                ? "mt-0.5 text-xs text-emerald-600 dark:text-emerald-400"
                : "mt-0.5 text-xs text-muted-foreground"
          }
        >
          Δ {formatDelta(delta)}
        </p>
      )}
    </div>
  );
}

function OverviewCards({
  metrics,
  compare,
}: {
  metrics: RunMetrics;
  compare?: CompareMetrics;
}) {
  const { overview } = metrics;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Pass rate"
        value={`${overview.passRate}%`}
        delta={compare?.deltas.passRateDelta}
      />
      <StatCard
        label="Total tokens"
        value={formatNumber(overview.totalTokens)}
        delta={compare?.deltas.totalTokensDelta}
      />
      <StatCard
        label="Avg query duration"
        value={`${formatNumber(overview.avgDurationMs)} ms`}
        delta={compare?.deltas.avgDurationMsDelta}
      />
      <StatCard
        label="LLM calls"
        value={formatNumber(overview.llmCallCount)}
      />
    </div>
  );
}

function OutcomesChart({ metrics }: { metrics: RunMetrics }) {
  const data = [
    { name: "Passed", value: metrics.statusBreakdown.passed, fill: CHART_COLORS.passed },
    { name: "Failed", value: metrics.statusBreakdown.failed, fill: CHART_COLORS.failed },
    { name: "Errors", value: metrics.statusBreakdown.errors, fill: CHART_COLORS.errors },
    {
      name: "Planner skip",
      value: metrics.statusBreakdown.plannerSkipped,
      fill: CHART_COLORS.plannerSkipped,
    },
  ].filter((entry) => entry.value > 0);

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No outcome data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

function ByGroupChart({ metrics }: { metrics: RunMetrics }) {
  const data = metrics.byGroup.map((group) => ({
    name: group.groupName,
    passed: group.passed,
    failed: group.failed + group.errors,
    skipped: group.plannerSkipped,
  }));

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No group data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="passed" stackId="a" fill={CHART_COLORS.passed} name="Passed" />
        <Bar dataKey="failed" stackId="a" fill={CHART_COLORS.failed} name="Failed / errors" />
        <Bar dataKey="skipped" stackId="a" fill={CHART_COLORS.plannerSkipped} name="Planner skip" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ByPhaseChart({ metrics }: { metrics: RunMetrics }) {
  const data = metrics.byPhase.map((entry) => ({
    name: entry.phase,
    count: entry.count,
  }));

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No failure phases recorded.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="count" fill={CHART_COLORS.failed} name="Count" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function TokenUsageChart({ metrics }: { metrics: RunMetrics }) {
  const data = [
    {
      name: "Tokens",
      prompt: metrics.overview.promptTokens,
      completion: metrics.overview.completionTokens,
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Total: {formatNumber(metrics.overview.totalTokens)} tokens
      </p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="name" hide />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="prompt" stackId="tokens" fill={CHART_COLORS.secondary} name="Prompt" />
          <Bar
            dataKey="completion"
            stackId="tokens"
            fill={CHART_COLORS.primary}
            name="Completion"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PerQueryChart({
  metrics,
  metric,
}: {
  metrics: RunMetrics;
  metric: "durationMs" | "totalTokens";
}) {
  const data = metrics.perQuery.slice(0, 24).map((row) => ({
    name: row.label,
    value: metric === "durationMs" ? row.durationMs : row.totalTokens,
  }));

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No per-query data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 22)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
        <Tooltip />
        <Bar
          dataKey="value"
          fill={metric === "durationMs" ? CHART_COLORS.accent : CHART_COLORS.secondary}
          name={metric === "durationMs" ? "Duration (ms)" : "Tokens"}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function LlmByNodeChart({ metrics }: { metrics: RunMetrics }) {
  const data = metrics.llmByNode.slice(0, 12).map((entry) => ({
    name: entry.node,
    calls: entry.callCount,
    avgLatency: entry.avgLatencyMs,
  }));

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No LLM call data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="left" dataKey="calls" fill={CHART_COLORS.primary} name="Call count" />
        <Bar
          yAxisId="right"
          dataKey="avgLatency"
          fill={CHART_COLORS.accent}
          name="Avg latency (ms)"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function AttemptsChart({ metrics }: { metrics: RunMetrics }) {
  const data = metrics.attemptDistribution.filter(
    (entry) => entry.executionCount > 1 || entry.queryCount > 0,
  );

  if (data.length === 0) {
    return <p className="text-xs text-muted-foreground">No rerun data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis
          dataKey="executionCount"
          tick={{ fontSize: 11 }}
          label={{ value: "Executions per query", position: "insideBottom", offset: -2, fontSize: 11 }}
        />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Bar dataKey="queryCount" fill={CHART_COLORS.secondary} name="Queries" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function CompareHeadToHead({ compare }: { compare: CompareMetrics }) {
  const data = [
    {
      metric: "Pass rate %",
      a: compare.a.overview.passRate,
      b: compare.b.overview.passRate,
    },
    {
      metric: "Total tokens",
      a: compare.a.overview.totalTokens,
      b: compare.b.overview.totalTokens,
    },
    {
      metric: "Avg duration (ms)",
      a: compare.a.overview.avgDurationMs,
      b: compare.b.overview.avgDurationMs,
    },
    {
      metric: "Errors",
      a: compare.a.statusBreakdown.errors,
      b: compare.b.statusBreakdown.errors,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
        <XAxis dataKey="metric" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="a" fill={CHART_COLORS.secondary} name="Run A" />
        <Bar dataKey="b" fill={CHART_COLORS.primary} name="Run B" />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ComparePerQueryDelta({ compare }: { compare: CompareMetrics }) {
  const rows = compare.perQueryOverlap.slice(0, 20);
  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No overlapping queries between the two runs.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Query</th>
            <th className="py-2 pr-3 font-medium">Duration Δ</th>
            <th className="py-2 pr-3 font-medium">Tokens Δ</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border/60">
              <td className="max-w-xs py-2 pr-3">
                <p className="truncate font-medium text-foreground">{row.label}</p>
                <p className="truncate text-muted-foreground">{row.groupName}</p>
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {formatDelta(row.durationDelta, " ms")}
              </td>
              <td className="py-2 pr-3 tabular-nums">
                {formatDelta(row.tokensDelta)}
              </td>
              <td className="py-2 text-muted-foreground">
                {row.statusA} → {row.statusB}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SingleProps {
  report: WorkflowTestCompletePayload;
  mode?: "single";
  compare?: never;
}

interface CompareProps {
  report?: never;
  mode: "compare";
  compare: CompareMetrics;
}

type Props = SingleProps | CompareProps;

export function WorkflowTestMetricsDashboard(props: Props) {
  const metrics = useMemo(() => {
    if (props.mode === "compare") return props.compare.a;
    return buildRunMetrics(props.report);
  }, [props]);

  const compare = props.mode === "compare" ? props.compare : undefined;

  return (
    <div className="space-y-6">
      <InspectSection title="Metrics overview">
        <OverviewCards metrics={metrics} compare={compare} />
      </InspectSection>

      {compare && (
        <InspectSection title="Head-to-head comparison">
          <CompareHeadToHead compare={compare} />
        </InspectSection>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <InspectSection title="Outcomes">
          <OutcomesChart metrics={metrics} />
        </InspectSection>

        <InspectSection title="Token usage">
          <TokenUsageChart metrics={metrics} />
        </InspectSection>
      </div>

      <InspectSection title="By group">
        <ByGroupChart metrics={metrics} />
      </InspectSection>

      {metrics.byPhase.length > 0 && (
        <InspectSection title="Failure phases">
          <ByPhaseChart metrics={metrics} />
        </InspectSection>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <InspectSection title="Per-query duration">
          <PerQueryChart metrics={metrics} metric="durationMs" />
        </InspectSection>
        <InspectSection title="Per-query tokens">
          <PerQueryChart metrics={metrics} metric="totalTokens" />
        </InspectSection>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <InspectSection title="LLM calls by node">
          <LlmByNodeChart metrics={metrics} />
        </InspectSection>
        <InspectSection title="Rerun attempts">
          <AttemptsChart metrics={metrics} />
        </InspectSection>
      </div>

      {compare && (
        <InspectSection title="Per-query deltas (overlapping queries)">
          <ComparePerQueryDelta compare={compare} />
        </InspectSection>
      )}
    </div>
  );
}

export { buildCompareMetrics };
