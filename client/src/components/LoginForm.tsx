import { useState } from "react";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/Card";
import { FormField } from "./ui/FormField";
import { Input } from "./ui/Input";
import { Label } from "./ui/Label";

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function LoginForm({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed.";
      setError(
        message.includes("401") || message.toLowerCase().includes("invalid")
          ? "Invalid email or password. Check your credentials and try again."
          : message,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto bg-background px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-primary to-violet-500 text-sm font-bold text-white shadow-lg">
          QF
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          QueryFabric DB Agent
        </h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Sign in to test the SQL agent playground. Natural language in, safe
          read-only SQL out.
        </p>
      </div>

      <Card className="w-full max-w-[420px]">
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>
            Seeded account: rahul@test.com / 1234
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <FormField>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="rahul@test.com"
                required
              />
            </FormField>

            <FormField>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </FormField>

            {error && (
              <Alert variant="error" title="Sign in failed">
                {error}
              </Alert>
            )}

            <Button type="submit" className="w-full" loading={loading}>
              Log in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
