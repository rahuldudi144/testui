import { Skeleton } from "../ui/Skeleton";

export function AppLoadingSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-[280px] shrink-0 border-r border-border bg-card p-4 md:block">
        <Skeleton className="mb-4 h-10 w-full" />
        <Skeleton className="mb-3 h-8 w-full" />
        <Skeleton className="mb-3 h-9 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-border px-6 py-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-32" />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Skeleton className="ml-auto h-20 w-2/3 max-w-md" />
          <Skeleton className="h-28 w-2/3 max-w-lg" />
          <Skeleton className="ml-auto h-16 w-1/2 max-w-sm" />
        </div>
      </main>
    </div>
  );
}
