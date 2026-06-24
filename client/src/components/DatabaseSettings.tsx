import { useEffect, useRef, useState } from "react";
import { Database, Plus } from "lucide-react";
import {
  activateDatabase,
  createDatabase,
  deleteDatabase,
  listDatabases,
  testDatabaseConnection,
  type UserDatabase,
} from "../api";
import { cn } from "../lib/cn";
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

export function DatabaseSettings({ onConnectionChange }: Props) {
  const [databases, setDatabases] = useState<UserDatabase[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserDatabase | null>(null);
  const [deleting, setDeleting] = useState(false);

  const addFormRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("My database");
  const [dbType, setDbType] = useState<"postgres" | "mysql">("postgres");
  const [dbUri, setDbUri] = useState(
    "postgresql://user:password@localhost:5432/mydb",
  );

  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => setSuccess(null), 5000);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await listDatabases();
      setDatabases(data.databases);
      setActiveId(data.activeDatabaseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load databases.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleTest() {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      await testDatabaseConnection(dbType, dbUri);
      setSuccess("Connection successful.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed.");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await createDatabase({ name, dbType, dbUri, setActive: true });
      setSuccess("Database saved and activated.");
      await refresh();
      onConnectionChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save database.");
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate(id: string) {
    setError(null);
    setSuccess(null);
    try {
      await activateDatabase(id);
      setActiveId(id);
      setSuccess("Active database updated.");
      onConnectionChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteDatabase(deleteTarget.id);
      setSuccess("Database connection deleted.");
      setDeleteTarget(null);
      await refresh();
      onConnectionChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    } finally {
      setDeleting(false);
    }
  }

  const active = databases.find((d) => d.id === activeId) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Database connections</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure PostgreSQL or MySQL targets for the SQL agent. Connections
          are saved to your account.
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
            </div>
            <Badge variant="success" className="normal-case">Active</Badge>
          </CardContent>
        </Card>
      ) : (
        <Alert variant="warning" title="No active database">
          Add a connection below before chatting with the SQL agent.
        </Alert>
      )}

      {error && (
        <Alert variant="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

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
              {databases.map((db) => (
                <div
                  key={db.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 transition-colors duration-150",
                    db.id === activeId
                      ? "border-primary/40 bg-primary/5"
                      : "border-border bg-background hover:bg-muted/30",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={db.dbType === "postgres" ? "postgres" : "mysql"}>
                        {db.dbType}
                      </Badge>
                      {db.id === activeId && (
                        <Badge variant="success" className="normal-case">Active</Badge>
                      )}
                    </div>
                    <p className="mt-1 font-medium text-foreground">{db.name}</p>
                    <p className="text-sm text-muted-foreground">{db.host}</p>
                  </div>
                  <div className="flex gap-2">
                    {db.id !== activeId && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleActivate(db.id)}
                      >
                        Set active
                      </Button>
                    )}
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
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card ref={addFormRef}>
        <CardHeader>
          <CardTitle>Add connection</CardTitle>
          <CardDescription>
            Test your URI before saving. The connection will be set as active.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="grid max-w-lg gap-4">
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

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleTest}
                loading={testing}
              >
                Test connection
              </Button>
              <Button type="submit" loading={saving}>
                Save & activate
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

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
