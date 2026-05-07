"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  File,
  FileCode,
  FileText,
  Film,
  Image,
  Loader2,
  Music,
  Presentation,
  Search,
  SendHorizontal,
  Sheet,
  Sparkles,
} from "lucide-react";
import { cn, formatBytes, getFileIcon, getFileIconTone } from "@/lib/utils";
import {
  searchDocuments,
  type SearchResult,
  type SearchResponse,
} from "@/lib/api";

const FILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText, Image, Film, Music, Archive, FileCode, Sheet, Presentation, File,
};

function FileIconComponent({ extension, className }: { extension: string; className?: string }) {
  const IconComp = FILE_ICONS[getFileIcon(extension)] || File;
  return <IconComp className={className} />;
}

function getExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

interface Interaction {
  id: string;
  query: string;
  results: SearchResult[];
  message: string;
  timestamp: Date;
}

export function KnowledgePanel({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const resultsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    resultsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [interactions, searching]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || searching) return;

    setSearching(true);
    setQuery("");

    try {
      const response: SearchResponse = await searchDocuments(workspaceId, q);
      setInteractions((prev) => [
        ...prev,
        {
          id: response.interaction_id,
          query: q,
          results: response.results,
          message: response.message,
          timestamp: new Date(),
        },
      ]);
    } catch {
      setInteractions((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          query: q,
          results: [],
          message: "Search failed. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setSearching(false);
    }
  }, [query, workspaceId, searching]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-zinc-200/70 px-4 py-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 text-white shadow-sm">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Ask AI</h3>
          <p className="text-[11px] text-zinc-400">Search your documents</p>
        </div>
      </div>

      {/* Conversation area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {interactions.length === 0 && !searching ? (
          <div className="flex h-full flex-col items-center justify-center px-4">
            <div className="rounded-2xl bg-zinc-100 p-4">
              <Search className="h-8 w-8 text-zinc-400" />
            </div>
            <p className="mt-4 text-sm font-medium text-zinc-700">Ask anything</p>
            <p className="mt-1 max-w-[220px] text-center text-xs text-zinc-400">
              Search your documents in natural language
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {interactions.map((interaction) => (
              <div key={interaction.id} className="space-y-2">
                {/* User query */}
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-zinc-900 px-3.5 py-2 text-[13px] leading-relaxed text-white">
                    {interaction.query}
                  </div>
                </div>

                {/* AI response */}
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-zinc-900 text-white">
                    <Sparkles className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-zinc-500">
                      {interaction.message}
                    </p>

                    {interaction.results.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {interaction.results.map((result, idx) => {
                          const ext = getExtension(result.name);
                          const tone = getFileIconTone(ext);
                          return (
                            <div
                              key={`${interaction.id}-${idx}`}
                              className="group flex items-center gap-2.5 rounded-lg border border-zinc-100 bg-white px-2.5 py-2 transition hover:border-zinc-300 hover:shadow-sm"
                            >
                              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1", tone)}>
                                <FileIconComponent extension={ext} className="h-3.5 w-3.5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-zinc-900">
                                  {result.name}
                                </p>
                                <p className="truncate text-[11px] text-zinc-400">
                                  {result.relevance}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                                  result.score >= 0.8
                                    ? "bg-emerald-50 text-emerald-700"
                                    : result.score >= 0.5
                                      ? "bg-amber-50 text-amber-700"
                                      : "bg-zinc-100 text-zinc-500",
                                )}
                              >
                                {Math.round(result.score * 100)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={cn(
                        "mt-1.5 rounded-lg border px-3 py-4 text-center",
                        interaction.message.includes("failed") || interaction.message.includes("error")
                          ? "border-rose-200 bg-rose-50"
                          : "border-zinc-100 bg-zinc-50",
                      )}>
                        <p className={cn(
                          "text-xs",
                          interaction.message.includes("failed") || interaction.message.includes("error")
                            ? "text-rose-600"
                            : "text-zinc-500",
                        )}>
                          {interaction.message}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {searching && (
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-zinc-900 text-white">
                  <Sparkles className="h-3 w-3" />
                </span>
                <div className="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                  <span className="text-xs text-zinc-500">Searching…</span>
                </div>
              </div>
            )}

            <div ref={resultsEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-zinc-200/70 px-3 py-3">
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 transition",
            "focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-100",
          )}
        >
          <textarea
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your documents…"
            disabled={searching}
            rows={2}
            className="max-h-28 flex-1 resize-none bg-transparent text-[13px] leading-[1.4] text-zinc-800 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className={cn(
              "grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg transition",
              query.trim()
                ? "bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm"
                : "text-zinc-300",
            )}
          >
            {searching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SendHorizontal className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
