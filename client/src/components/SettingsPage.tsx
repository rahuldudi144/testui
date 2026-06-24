import { useState } from "react";
import type { User } from "../api";
import { PageHeader } from "./layout/PageHeader";
import { AgentSettings } from "./AgentSettings";
import { DatabaseSettings } from "./DatabaseSettings";
import { UserSettings } from "./UserSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/Tabs";

type SettingsTab = "database" | "agent" | "users";

interface Props {
  user: User;
  onBack: () => void;
  onDatabaseChange: () => void;
}

export function SettingsPage({ user, onBack, onDatabaseChange }: Props) {
  const [tab, setTab] = useState<SettingsTab>("database");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Settings"
          description="Manage database connections and test users"
          breadcrumbs={[
            { label: "Conversations", onClick: onBack },
            { label: "Settings" },
            { label: tab === "database" ? "Database" : tab === "agent" ? "Agent" : "Users" },
          ]}
          onBack={onBack}
        />

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as SettingsTab)}
        >
          <TabsList aria-label="Settings sections">
            <TabsTrigger value="database">Database</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>

          <TabsContent value="database">
            <DatabaseSettings onConnectionChange={onDatabaseChange} />
          </TabsContent>

          <TabsContent value="agent">
            <AgentSettings />
          </TabsContent>

          <TabsContent value="users">
            <UserSettings currentUser={user} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
