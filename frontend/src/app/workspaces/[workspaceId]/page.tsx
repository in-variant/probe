"use client";

import { use, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { DocumentsView } from "@/components/documents-view";
import { KnowledgePanel } from "@/components/knowledge-panel";

export default function WorkspaceDocumentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = use(params);
  const [showMobilePanel, setShowMobilePanel] = useState(false);

  return (
    <>
      <div className="flex h-[calc(100dvh-7.5rem)] gap-4 pb-14 lg:pb-0">
        <div className="min-w-0 flex-1">
          <DocumentsView workspaceId={workspaceId} />
        </div>

        <div className="hidden w-[380px] shrink-0 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white lg:block">
          <KnowledgePanel workspaceId={workspaceId} />
        </div>
      </div>

      {/* Mobile Knowledge Panel FAB */}
      <button
        type="button"
        onClick={() => setShowMobilePanel(true)}
        className="fixed bottom-16 right-4 z-20 grid h-12 w-12 place-items-center rounded-full bg-zinc-900 text-white shadow-lg transition-transform active:scale-95 lg:hidden"
        aria-label="Open knowledge panel"
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      {/* Mobile Knowledge Panel overlay */}
      {showMobilePanel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white animate-fade-in lg:hidden">
          <div className="flex items-center justify-between border-b border-zinc-200/70 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">Knowledge Panel</h2>
            <button
              onClick={() => setShowMobilePanel(false)}
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <KnowledgePanel workspaceId={workspaceId} />
          </div>
        </div>
      )}
    </>
  );
}
