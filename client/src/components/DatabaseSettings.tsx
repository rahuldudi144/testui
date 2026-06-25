import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Database, Plus, RefreshCw } from "lucide-react";
import {
  activateDatabase,
  createDatabase,
  deleteDatabase,
  fetchDatabaseSchema,
  listDatabases,
  previewDatabaseSchema,
  syncDatabaseSchema,
  testDatabaseConnection,
  updateDatabase,
  type SchemaSyncStatus,
  type UserDatabase,
} from "../api";
import { cn } from "../lib/cn";
import { SchemaMetadataView } from "./SchemaMetadataView";
import { Alert } from "./ui/Alert";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/Card";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { EmptyState } from "./ui/EmptyState";
import { FormField } from "./ui/FormField";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";
import { Select } from "./ui/Select";
import { Skeleton } from "./ui/Skeleton";
import { Textarea } from "./ui/Textarea";

interface Props {
  onConnectionChange?: () => void;
}

type NoticeVariant = "success" | "warning" | "error";

interface ConnectionNotice {
  variant: NoticeVariant;
  message: string;
}

function schemaStatusBadge(status: SchemaSyncStatus): {
  variant: "success" | "warning" | "destructive" | "outline" | "info";
  label: string;
} {
  switch (status) {
    case "ready":
      return { variant: "success", label: "Schema ready" };
    case "syncing":
      return { variant: "info", label: "Syncing schema…" };
    case "failed":
      return { variant: "destructive", label: "Schema sync failed" };
    default:
      return { variant: "outline", label: "Schema not synced" };
  }
}

function ConnectionNoticeBanner({
  notice,
  onDismiss,
}: {
  notice: ConnectionNotice | null;
  onDismiss?: () => void;
}) {
  if (!notice) return null;
  return (
    <Alert variant={notice.variant} onDismiss={onDismiss} className="rounded-none border-x-0 border-t-0">
      {notice.message}
    </Alert>
  );
}

type ButtonFeedbackStatus = "success" | "error" | "warning";

interface ButtonFeedback {
  status: ButtonFeedbackStatus;
  message: string;
}

const feedbackButtonClass: Record<ButtonFeedbackStatus, string> = {
  success: "border border-success/40 bg-success/10 text-success hover:bg-success/15",
  error:
    "border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
  warning: "border border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
};

function FeedbackButton({
  idleLabel,
  loading = false,
  feedback = null,
  className,
  children,
  onClick,
  variant = "secondary",
  ...props
}: {
  idleLabel: string;
  loading?: boolean;
  feedback?: ButtonFeedback | null;
} & React.ComponentProps<typeof Button>) {
  const label = loading ? idleLabel : (feedback?.message ?? idleLabel);

  return (
    <Button
      {...props}
      loading={loading}
      variant={feedback ? "secondary" : variant}
      className={cn(
        className,
        feedback && feedbackButtonClass[feedback.status],
        feedback && "max-w-xs",
      )}
      title={feedback && feedback.message.length > 28 ? feedback.message : undefined}
      onClick={onClick}
    >
      <span className="truncate">{children ?? label}</span>
    </Button>
  );
}

function useFeedbackTimer() {
  const timers = useRef<Record<string, number>>({});

  const scheduleClear = (key: string, clear: () => void, ms = 5000) => {
    if (timers.current[key]) window.clearTimeout(timers.current[key]);
    timers.current[key] = window.setTimeout(() => {
      clear();
      delete timers.current[key];
    }, ms);
  };

  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return { scheduleClear };
}

export function DatabaseSettings({ onConnectionChange }: Props) {
  const [databases, setDatabases] = useState<UserDatabase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [addFormNotice, setAddFormNotice] = useState<ConnectionNotice | null>(null);
  const [connectionNotices, setConnectionNotices] = useState<
    Record<string, ConnectionNotice>
  >({});
  const [deleteTarget, setDeleteTarget] = useState<UserDatabase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [testingEditId, setTestingEditId] = useState<string | null>(null);
  const [addTestFeedback, setAddTestFeedback] = useState<ButtonFeedback | null>(null);
  const [addSaveFeedback, setAddSaveFeedback] = useState<ButtonFeedback | null>(null);
  const [editTestFeedback, setEditTestFeedback] = useState<
    Record<string, ButtonFeedback>
  >({});
  const [editSaveFeedback, setEditSaveFeedback] = useState<
    Record<string, ButtonFeedback>
  >({});

  const noticeTimers = useRef<Record<string, number>>({});
  const addFormNoticeTimer = useRef<number | null>(null);
  const { scheduleClear: scheduleFeedbackClear } = useFeedbackTimer();

  const addFormRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("My database");
  const [dbType, setDbType] = useState<"postgres" | "mysql">("postgres");
  const [dbUri, setDbUri] = useState(
    "postgresql://user:password@localhost:5432/mydb",
  );
  const [businessContext, setBusinessContext] = useState("");
  const [fetchSchema, setFetchSchema] = useState(true);
  const [previewingSchema, setPreviewingSchema] = useState(false);
  const [schemaPreview, setSchemaPreview] = useState<{
    key: string;
    metadata: unknown;
    tableCount: number;
  } | null>(null);

  const [editPreviewingSchema, setEditPreviewingSchema] = useState(false);
  const [editSchemaPreview, setEditSchemaPreview] = useState<{
    key: string;
    metadata: unknown;
    tableCount: number;
  } | null>(null);
  const [editStoredMetadata, setEditStoredMetadata] = useState<unknown>(null);
  const [editStoredLoading, setEditStoredLoading] = useState(false);
  const [editDraftMetadata, setEditDraftMetadata] = useState<unknown>(null);

  const [editName, setEditName] = useState("");
  const [editDbType, setEditDbType] = useState<"postgres" | "mysql">("postgres");
  const [editDbUri, setEditDbUri] = useState("");
  const [editBusinessContext, setEditBusinessContext] = useState("");
  const [editSourceDb, setEditSourceDb] = useState<UserDatabase | null>(null);

  function clearNoticeTimer(key: string) {
    const timer = noticeTimers.current[key];
    if (timer) {
      window.clearTimeout(timer);
      delete noticeTimers.current[key];
    }
  }

  function showConnectionNotice(
    dbId: string,
    variant: NoticeVariant,
    message: string,
  ) {
    clearNoticeTimer(dbId);
    setConnectionNotices((prev) => ({ ...prev, [dbId]: { variant, message } }));
    noticeTimers.current[dbId] = window.setTimeout(() => {
      setConnectionNotices((prev) => {
        const next = { ...prev };
        delete next[dbId];
        return next;
      });
      delete noticeTimers.current[dbId];
    }, 6000);
  }

  function dismissConnectionNotice(dbId: string) {
    clearNoticeTimer(dbId);
    setConnectionNotices((prev) => {
      const next = { ...prev };
      delete next[dbId];
      return next;
    });
  }

  function showAddFormNotice(variant: NoticeVariant, message: string) {
    if (addFormNoticeTimer.current) {
      window.clearTimeout(addFormNoticeTimer.current);
    }
    setAddFormNotice({ variant, message });
    addFormNoticeTimer.current = window.setTimeout(() => {
      setAddFormNotice(null);
      addFormNoticeTimer.current = null;
    }, 6000);
  }

  async function refresh() {
    setLoading(true);
    try {
      const data = await listDatabases();
      setDatabases(data.databases);
      setActiveId(data.activeDatabaseId);
      setPageError(null);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : "Failed to load databases.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      Object.values(noticeTimers.current).forEach((timer) => window.clearTimeout(timer));
      if (addFormNoticeTimer.current) window.clearTimeout(addFormNoticeTimer.current);
    };
  }, []);

  const addPreviewKey = `${dbType}::${dbUri.trim()}`;
  const addPreviewCurrent = schemaPreview?.key === addPreviewKey;
  const editPreviewKey = `${editDbType}::${editDbUri.trim()}`;
  const editPreviewCurrent = editSchemaPreview?.key === editPreviewKey;
  const editUriChanged =
    editSourceDb !== null &&
    (editDbUri !== editSourceDb.dbUri || editDbType !== editSourceDb.dbType);

  useEffect(() => {
    setSchemaPreview(null);
    setAddTestFeedback(null);
  }, [dbType, dbUri]);

  useEffect(() => {
    setEditSchemaPreview(null);
    setEditDraftMetadata(null);
    if (editingId) {
      setEditTestFeedback((prev) => {
        const next = { ...prev };
        delete next[editingId];
        return next;
      });
    }
  }, [editDbType, editDbUri, editingId]);

  async function handleTest() {
    setTesting(true);
    setAddTestFeedback(null);
    try {
      await testDatabaseConnection(dbType, dbUri);
      setAddTestFeedback({ status: "success", message: "Connection successful" });
      scheduleFeedbackClear("add-test", () => setAddTestFeedback(null));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setAddTestFeedback({ status: "error", message });
      scheduleFeedbackClear("add-test", () => setAddTestFeedback(null));
    } finally {
      setTesting(false);
    }
  }

  async function handlePreviewSchema() {
    setPreviewingSchema(true);
    setAddFormNotice(null);
    try {
      const preview = await previewDatabaseSchema(dbType, dbUri.trim());
      setSchemaPreview({
        key: addPreviewKey,
        metadata: preview.dbMetadata,
        tableCount: preview.schemaTableCount,
      });
      showAddFormNotice(
        "success",
        `Schema preview ready (${preview.schemaTableCount} tables). Review below before saving.`,
      );
    } catch (err) {
      showAddFormNotice(
        "error",
        err instanceof Error ? err.message : "Schema preview failed.",
      );
    } finally {
      setPreviewingSchema(false);
    }
  }

  async function handleEditPreviewSchema(dbId: string) {
    setEditPreviewingSchema(true);
    dismissConnectionNotice(dbId);
    try {
      const preview = await previewDatabaseSchema(editDbType, editDbUri.trim());
      setEditSchemaPreview({
        key: editPreviewKey,
        metadata: preview.dbMetadata,
        tableCount: preview.schemaTableCount,
      });
      setEditDraftMetadata(preview.dbMetadata);
      showConnectionNotice(
        dbId,
        "success",
        `Schema preview ready (${preview.schemaTableCount} tables). Save to store it on this connection.`,
      );
    } catch (err) {
      showConnectionNotice(
        dbId,
        "error",
        err instanceof Error ? err.message : "Schema preview failed.",
      );
    } finally {
      setEditPreviewingSchema(false);
    }
  }

  async function handleEditTest(dbId: string) {
    setTestingEditId(dbId);
    setEditTestFeedback((prev) => {
      const next = { ...prev };
      delete next[dbId];
      return next;
    });
    try {
      await testDatabaseConnection(editDbType, editDbUri.trim());
      setEditTestFeedback((prev) => ({
        ...prev,
        [dbId]: { status: "success", message: "Connection successful" },
      }));
      scheduleFeedbackClear(`edit-test-${dbId}`, () =>
        setEditTestFeedback((prev) => {
          const next = { ...prev };
          delete next[dbId];
          return next;
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setEditTestFeedback((prev) => ({
        ...prev,
        [dbId]: { status: "error", message },
      }));
      scheduleFeedbackClear(`edit-test-${dbId}`, () =>
        setEditTestFeedback((prev) => {
          const next = { ...prev };
          delete next[dbId];
          return next;
        }),
      );
    } finally {
      setTestingEditId(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAddSaveFeedback(null);
    try {
      const result = await createDatabase({
        name,
        dbType,
        dbUri,
        businessContext: businessContext.trim() || undefined,
        setActive: true,
        fetchSchema,
        dbMetadata:
          fetchSchema && addPreviewCurrent ? schemaPreview.metadata : undefined,
      });
      if (result.warning) {
        setAddSaveFeedback({ status: "warning", message: result.warning });
      } else {
        setAddSaveFeedback({
          status: "success",
          message: fetchSchema
            ? "Saved & schema annotated"
            : "Saved & activated",
        });
      }
      scheduleFeedbackClear("add-save", () => setAddSaveFeedback(null), 6000);
      await refresh();
      onConnectionChange?.();
      setSchemaPreview(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setAddSaveFeedback({ status: "error", message });
      scheduleFeedbackClear("add-save", () => setAddSaveFeedback(null));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: string) {
    dismissConnectionNotice(id);
    try {
      await activateDatabase(id);
      setActiveId(id);
      showConnectionNotice(id, "success", "Set as active database.");
      onConnectionChange?.();
    } catch (err) {
      showConnectionNotice(
        id,
        "error",
        err instanceof Error ? err.message : "Failed to activate.",
      );
    }
  }

  async function handleResync(id: string) {
    setSyncingId(id);
    dismissConnectionNotice(id);
    try {
      await syncDatabaseSchema(id);
      showConnectionNotice(id, "success", "Schema synced and annotated.");
      await refresh();
      onConnectionChange?.();
    } catch (err) {
      showConnectionNotice(
        id,
        "error",
        err instanceof Error ? err.message : "Schema sync failed.",
      );
      await refresh();
    } finally {
      setSyncingId(null);
    }
  }

  async function loadEditStoredSchema(db: UserDatabase) {
    if (db.schemaSyncStatus !== "ready") {
      setEditStoredMetadata(null);
      setEditDraftMetadata(null);
      return;
    }
    setEditStoredLoading(true);
    try {
      const data = await fetchDatabaseSchema(db.id);
      setEditStoredMetadata(data.dbMetadata);
      setEditDraftMetadata(data.dbMetadata);
    } catch {
      setEditStoredMetadata(null);
      setEditDraftMetadata(null);
    } finally {
      setEditStoredLoading(false);
    }
  }

  function startEdit(db: UserDatabase) {
    setEditingId(db.id);
    setEditSourceDb(db);
    setEditName(db.name);
    setEditDbType(db.dbType);
    setEditDbUri(db.dbUri);
    setEditBusinessContext(db.businessContext ?? "");
    setEditSchemaPreview(null);
    setEditStoredMetadata(null);
    setEditDraftMetadata(null);
    setExpandedId(db.id);
    void loadEditStoredSchema(db);
  }

  function cancelEdit(dbId: string) {
    setEditingId(null);
    setEditSourceDb(null);
    setEditSchemaPreview(null);
    setEditStoredMetadata(null);
    setEditDraftMetadata(null);
    setEditTestFeedback((prev) => {
      const next = { ...prev };
      delete next[dbId];
      return next;
    });
    setEditSaveFeedback((prev) => {
      const next = { ...prev };
      delete next[dbId];
      return next;
    });
    dismissConnectionNotice(dbId);
  }

  async function handleSaveEdit(db: UserDatabase) {
    setSavingEditId(db.id);
    setEditSaveFeedback((prev) => {
      const next = { ...prev };
      delete next[db.id];
      return next;
    });
    try {
      const uriChanged = editDbUri !== db.dbUri || editDbType !== db.dbType;
      await updateDatabase(db.id, {
        name: editName,
        dbType: editDbType,
        dbUri: editDbUri,
        businessContext: editBusinessContext,
        ...(editDraftMetadata !== null ? { dbMetadata: editDraftMetadata } : {}),
      });
      const feedback: ButtonFeedback =
        uriChanged && editDraftMetadata === null
          ? {
              status: "warning",
              message: "Saved — resync schema for new URI",
            }
          : { status: "success", message: "Changes saved" };

      setEditSaveFeedback((prev) => ({ ...prev, [db.id]: feedback }));
      scheduleFeedbackClear(`edit-save-${db.id}`, () => {
        setEditSaveFeedback((prev) => {
          const next = { ...prev };
          delete next[db.id];
          return next;
        });
        setEditingId(null);
        setEditSourceDb(null);
        setEditSchemaPreview(null);
        setEditStoredMetadata(null);
        setEditDraftMetadata(null);
      }, 1500);

      await refresh();
      onConnectionChange?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setEditSaveFeedback((prev) => ({
        ...prev,
        [db.id]: { status: "error", message },
      }));
      scheduleFeedbackClear(`edit-save-${db.id}`, () =>
        setEditSaveFeedback((prev) => {
          const next = { ...prev };
          delete next[db.id];
          return next;
        }),
      );
    } finally {
      setSavingEditId(null);
    }
  }

  async function handleSaveBusinessContext(db: UserDatabase, value: string) {
    setSavingEditId(db.id);
    dismissConnectionNotice(db.id);
    try {
      await updateDatabase(db.id, { businessContext: value });
      showConnectionNotice(db.id, "success", "Business context saved.");
      await refresh();
      onConnectionChange?.();
    } catch (err) {
      showConnectionNotice(
        db.id,
        "error",
        err instanceof Error ? err.message : "Failed to save business context.",
      );
    } finally {
      setSavingEditId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const deletedId = deleteTarget.id;
    setDeleting(true);
    dismissConnectionNotice(deletedId);
    try {
      await deleteDatabase(deletedId);
      setDeleteTarget(null);
      if (expandedId === deletedId) setExpandedId(null);
      if (editingId === deletedId) {
        setEditingId(null);
        setEditSourceDb(null);
      }
      await refresh();
      onConnectionChange?.();
      showAddFormNotice("success", "Database connection deleted.");
    } catch (err) {
      showConnectionNotice(
        deletedId,
        "error",
        err instanceof Error ? err.message : "Failed to delete.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const active = databases.find((d) => d.id === activeId) ?? null;

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Database connections</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure PostgreSQL or MySQL targets. Schema metadata and business
          context are stored per connection and sent with every agent request.
        </p>
      </div>

      {active ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-start gap-3 p-4">
            <Badge variant={active.dbType === "postgres" ? "postgres" : "mysql"}>
              {active.dbType}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{active.name}</p>
              <p className="text-sm text-muted-foreground">{active.host}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge
                  variant={schemaStatusBadge(active.schemaSyncStatus).variant}
                  className="normal-case"
                >
                  {schemaStatusBadge(active.schemaSyncStatus).label}
                </Badge>
                {active.schemaTableCount > 0 && (
                  <Badge variant="outline" className="normal-case">
                    {active.schemaTableCount} tables
                  </Badge>
                )}
                {active.hasBusinessContext && (
                  <Badge variant="outline" className="normal-case">
                    Business context set
                  </Badge>
                )}
              </div>
            </div>
            <Badge variant="success" className="normal-case">Active</Badge>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="warning" title="No active database">
          Add a connection below before chatting with the SQL agent.
        </Alert>
      )}

      {pageError && (
        <Alert variant="error" onDismiss={() => setPageError(null)}>
          {pageError}
        </Alert>
      )}

      <div className="grid w-full gap-6 xl:grid-cols-2 xl:items-start">
      <Card>
        <CardHeader>
          <CardTitle>Saved connections</CardTitle>
          <CardDescription>Manage your database connection profiles</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : databases.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No connections saved"
              description="Add your first PostgreSQL or MySQL connection to start querying."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addFormRef.current?.scrollIntoView({ behavior: "smooth" })}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add connection
                </Button>
              }
              className="py-6"
            />
          ) : (
            <div className="space-y-3">
              {databases.map((db) => {
                const expanded = expandedId === db.id;
                const editing = editingId === db.id;
                const status = schemaStatusBadge(db.schemaSyncStatus);
                const notice = connectionNotices[db.id] ?? null;

                return (
                  <div
                    key={db.id}
                    className={cn(
                      "overflow-hidden rounded-lg border transition-colors duration-150",
                      db.id === activeId
                        ? "border-primary/40 bg-primary/5"
                        : "border-border bg-background",
                    )}
                  >
                    <ConnectionNoticeBanner
                      notice={notice}
                      onDismiss={() => dismissConnectionNotice(db.id)}
                    />

                    <div className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : db.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left focus-ring rounded-md"
                          aria-expanded={expanded}
                        >
                          {expanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2">
                              <Badge variant={db.dbType === "postgres" ? "postgres" : "mysql"}>
                                {db.dbType}
                              </Badge>
                              {db.id === activeId && (
                                <Badge variant="success" className="normal-case">Active</Badge>
                              )}
                              <Badge variant={status.variant} className="normal-case">
                                {status.label}
                              </Badge>
                            </span>
                            <span className="mt-1 block font-medium text-foreground">
                              {db.name}
                            </span>
                            <span className="block text-sm text-muted-foreground">
                              {db.host}
                            </span>
                            {db.schemaTableCount > 0 && (
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {db.schemaTableCount} tables
                                {db.schemaSyncedAt &&
                                  ` · synced ${new Date(db.schemaSyncedAt).toLocaleString()}`}
                              </span>
                            )}
                          </span>
                        </button>
                        <div className="flex flex-wrap gap-2">
                          {db.id !== activeId && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => void handleActivate(db.id)}
                            >
                              Set active
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={syncingId === db.id}
                            disabled={syncingId === db.id}
                            onClick={() => void handleResync(db.id)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                            Resync schema
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              editing ? cancelEdit(db.id) : startEdit(db)
                            }
                          >
                            {editing ? "Cancel edit" : "Edit"}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => setDeleteTarget(db)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </div>

                    {expanded && (
                      <div className="space-y-4 border-t border-border bg-muted/10 p-4">
                        {db.schemaSyncError && !editing && (
                          <Alert variant="error">{db.schemaSyncError}</Alert>
                        )}

                        {db.schemaSyncStatus === "ready" && !editing && (
                          <SavedConnectionSchema
                            dbId={db.id}
                            schemaSyncedAt={db.schemaSyncedAt}
                          />
                        )}

                        {editing ? (
                          <div className="grid w-full gap-4">
                            <FormField>
                              <Label htmlFor={`edit-name-${db.id}`}>Name</Label>
                              <Input
                                id={`edit-name-${db.id}`}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                              />
                            </FormField>
                            <FormField>
                              <Label htmlFor={`edit-type-${db.id}`}>Engine</Label>
                              <Select
                                id={`edit-type-${db.id}`}
                                value={editDbType}
                                onChange={(e) =>
                                  setEditDbType(e.target.value as "postgres" | "mysql")
                                }
                              >
                                <option value="postgres">PostgreSQL</option>
                                <option value="mysql">MySQL</option>
                              </Select>
                            </FormField>
                            <FormField>
                              <Label htmlFor={`edit-uri-${db.id}`}>Connection URI</Label>
                              <Textarea
                                id={`edit-uri-${db.id}`}
                                value={editDbUri}
                                onChange={(e) => setEditDbUri(e.target.value)}
                                rows={3}
                              />
                            </FormField>
                            <FormField>
                              <Label htmlFor={`edit-context-${db.id}`}>
                                Business context
                              </Label>
                              <Textarea
                                id={`edit-context-${db.id}`}
                                value={editBusinessContext}
                                onChange={(e) => setEditBusinessContext(e.target.value)}
                                rows={4}
                                placeholder="Domain glossary, metric definitions…"
                              />
                            </FormField>

                            <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    Schema preview
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {editPreviewCurrent
                                      ? "Showing freshly fetched preview."
                                      : editUriChanged
                                        ? "URI changed — fetch a new preview before saving."
                                        : "Showing stored schema. Fetch to preview changes."}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <FeedbackButton
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    idleLabel="Test connection"
                                    loading={testingEditId === db.id}
                                    feedback={editTestFeedback[db.id] ?? null}
                                    onClick={() => void handleEditTest(db.id)}
                                  />
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    loading={editPreviewingSchema}
                                    onClick={() => void handleEditPreviewSchema(db.id)}
                                  >
                                    Fetch & preview schema
                                  </Button>
                                </div>
                              </div>
                              {editStoredLoading && editDraftMetadata === null ? (
                                <Skeleton className="h-32 w-full" />
                              ) : editDraftMetadata ? (
                                <SchemaMetadataView
                                  metadata={editDraftMetadata}
                                  editable
                                  onMetadataChange={setEditDraftMetadata}
                                />
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  {editUriChanged
                                    ? "Connection details changed. Fetch the annotated schema before saving."
                                    : "No stored schema yet. Fetch and preview to annotate tables."}
                                </p>
                              )}
                            </div>

                            <FeedbackButton
                              type="button"
                              idleLabel="Save changes"
                              loading={savingEditId === db.id}
                              feedback={editSaveFeedback[db.id] ?? null}
                              onClick={() => void handleSaveEdit(db)}
                            />
                          </div>
                        ) : (
                          <ConnectionBusinessContext
                            db={db}
                            saving={savingEditId === db.id}
                            onSave={(value) => void handleSaveBusinessContext(db, value)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card ref={addFormRef}>
        <CardHeader>
          <CardTitle>Add connection</CardTitle>
          <CardDescription>
            Test your URI before saving. Optionally fetch and annotate schema with
            the agent LLM.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ConnectionNoticeBanner
            notice={addFormNotice}
            onDismiss={() => setAddFormNotice(null)}
          />
          <form onSubmit={handleSave} className="grid w-full gap-4 p-6 pt-4">
            <FormField>
              <Label htmlFor="db-name">Name</Label>
              <Input
                id="db-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </FormField>

            <FormField>
              <Label htmlFor="db-type">Engine</Label>
              <Select
                id="db-type"
                value={dbType}
                onChange={(e) => {
                  const next = e.target.value as "postgres" | "mysql";
                  setDbType(next);
                  setDbUri(
                    next === "postgres"
                      ? "postgresql://user:password@localhost:5432/mydb"
                      : "mysql://user:password@localhost:3306/mydb",
                  );
                }}
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="db-uri">Connection URI</Label>
              <Textarea
                id="db-uri"
                value={dbUri}
                onChange={(e) => setDbUri(e.target.value)}
                rows={3}
                required
              />
            </FormField>

            <FormField>
              <Label htmlFor="db-business-context">Business context</Label>
              <Textarea
                id="db-business-context"
                value={businessContext}
                onChange={(e) => setBusinessContext(e.target.value)}
                rows={4}
                placeholder="Domain glossary, metric definitions, naming conventions…"
              />
              <p className="text-xs text-muted-foreground">
                Appended to the agent system prompt for queries against this database.
              </p>
            </FormField>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={fetchSchema}
                onChange={(e) => setFetchSchema(e.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">
                  Fetch and annotate schema on save
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Connects to the database, fetches tables, and runs parseSchema to
                  add description annotations. Preview below before saving.
                </span>
              </span>
            </label>

            {fetchSchema && (
              <div className="space-y-3 rounded-md border border-border bg-muted/10 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Schema preview</p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={previewingSchema}
                    onClick={() => void handlePreviewSchema()}
                  >
                    Fetch & preview schema
                  </Button>
                </div>
                {addPreviewCurrent ? (
                  <SchemaMetadataView
                    metadata={schemaPreview.metadata}
                    editable
                    onMetadataChange={(next) =>
                      setSchemaPreview((prev) =>
                        prev ? { ...prev, metadata: next } : null,
                      )
                    }
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Fetch the annotated schema to review tables and column descriptions
                    before saving this connection.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <FeedbackButton
                type="button"
                variant="secondary"
                idleLabel="Test connection"
                loading={testing}
                feedback={addTestFeedback}
                onClick={() => void handleTest()}
              />
              <FeedbackButton
                type="submit"
                variant="default"
                idleLabel="Save & activate"
                loading={saving}
                feedback={addSaveFeedback}
              />
            </div>
          </form>
        </CardContent>
      </Card>
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete database connection?"
        description={
          deleteTarget?.id === activeId
            ? `"${deleteTarget.name}" is your active connection. Deleting it will disconnect the agent until you configure another database.`
            : `Remove "${deleteTarget?.name ?? "this connection"}" from your saved connections?`
        }
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function SavedConnectionSchema({
  dbId,
  schemaSyncedAt,
}: {
  dbId: string;
  schemaSyncedAt: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchDatabaseSchema(dbId)
      .then((data) => {
        if (!cancelled) setMetadata(data.dbMetadata);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load schema.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dbId, schemaSyncedAt]);

  if (loading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }
  if (!metadata) {
    return (
      <p className="text-sm text-muted-foreground">
        No annotated schema stored for this connection.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Annotated schema</p>
      <SchemaMetadataView metadata={metadata} />
    </div>
  );
}

function ConnectionBusinessContext({
  db,
  saving,
  onSave,
}: {
  db: UserDatabase;
  saving: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(db.businessContext ?? "");

  useEffect(() => {
    setValue(db.businessContext ?? "");
  }, [db.businessContext, db.id]);

  return (
    <div className="space-y-2">
      <Label htmlFor={`context-${db.id}`}>Business context</Label>
      <Textarea
        id={`context-${db.id}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="Domain glossary, metric definitions…"
      />
      <Button
        type="button"
        size="sm"
        loading={saving}
        disabled={value === (db.businessContext ?? "")}
        onClick={() => onSave(value)}
      >
        Save business context
      </Button>
    </div>
  );
}
