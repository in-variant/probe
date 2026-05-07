"use client";

import { use } from "react";
import { DocumentsView } from "@/components/documents-view";
import { KnowledgePanel } from "@/components/knowledge-panel";

export default function WorkspaceDocumentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] gap-4">
      <div className="min-w-0 flex-1">
        <DocumentsView workspaceId={workspaceId} />
      </div>

      <div className="hidden w-[380px] shrink-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white lg:block">
        <KnowledgePanel workspaceId={workspaceId} />
      </div>
    </div>
  );
}
