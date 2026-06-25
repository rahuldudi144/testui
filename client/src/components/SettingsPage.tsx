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
  onAgentChange?: () => void;
}

export function SettingsPage({ user, onBack, onDatabaseChange, onAgentChange }: Props) {
  const [tab, setTab] = useState<SettingsTab>("database");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-6 md:px-8 md:py-8">
      <div className="flex w-full min-w-0 flex-1 flex-col">
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
          className="flex w-full min-w-0 flex-1 flex-col"
        >
          <TabsList aria-label="Settings sections">
            <TabsTrigger value="database">Database</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>

          <TabsContent value="database" className="w-full">
            <DatabaseSettings onConnectionChange={onDatabaseChange} />
          </TabsContent>

          <TabsContent value="agent" className="w-full">
            <AgentSettings onAgentChange={onAgentChange} />
          </TabsContent>

          <TabsContent value="users" className="w-full">
            <UserSettings currentUser={user} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
