"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileSearch,
  FileText,
  Folder,
  Loader2,
  MessageSquare,
  SendHorizontal,
  Slash,
  Wrench,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import {
  getDownloadUrl,
  getFileTextContent,
  listDocuments,
  listWorkspaces,
  searchDocuments,
  writeTextFile,
  createFolder,
  deleteFile,
  type SearchResult,
  type Workspace,
} from "@/lib/api";

type TreeNode = {
  path: string;
  name: string;
  type: "folder" | "file";
  children?: TreeNode[];
};

type ChatTurn = {
  id: string;
  query: string;
  summary: string;
  message: string;
  results: SearchResult[];
  status: "running" | "done" | "failed";
  tools: ToolEvent[];
};

type ToolEvent = {
  id: string;
  label: string;
  detail: string;
  status: "pending" | "running" | "done" | "failed";
};

function extOf(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([^\n])\n(#{1,3}\s)/g, "$1\n\n$2")
    .replace(/([^\n])\n(- |\* |\d+\. )/g, "$1\n\n$2")
    .trim();
}

function stripPlainSourceLines(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^Source:\s+/i.test(line.trim()) && !/^Sources:\s*$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function flattenFiles(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (items: TreeNode[]) => {
    for (const item of items) {
      if (item.type === "file") out.push(item.path);
      else walk(item.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

function parseTaggedFilePaths(value: string, validFiles: string[]): string[] {
  const valid = new Set(validFiles);
  const found = new Set<string>();
  const re = /@"([^"]+)"|@([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const raw = (match[1] || match[2] || "").replace(/[),.;:]+$/, "");
    if (valid.has(raw)) found.add(raw);
  }
  return [...found];
}

function sourcePath(resultPath: string): string {
  return resultPath.replace(/^\/+/, "");
}

function nodeAtPath(nodes: TreeNode[], path: string[]): TreeNode[] {
  let current = nodes;
  for (const segment of path) {
    const next = current.find((node) => node.type === "folder" && node.name === segment);
    current = next?.children ?? [];
  }
  return current;
}

function mentionSegments(value: string, validFiles: string[]) {
  const valid = new Set(validFiles);
  const segments: { text: string; highlight: boolean }[] = [];
  const re = /@"([^"]+)"|@([^\s]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const raw = match[1] || match[2] || "";
    const clean = raw.replace(/[),.;:]+$/, "");
    if (!valid.has(clean)) continue;
    if (match.index > last) segments.push({ text: value.slice(last, match.index), highlight: false });
    segments.push({ text: match[0], highlight: true });
    last = match.index + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last), highlight: false });
  return segments.length ? segments : [{ text: value || " ", highlight: false }];
}

const COMMANDS = [
  { id: "summary", label: "Summary Report", insert: "create a summary report for " },
  { id: "cdr", label: "CDR Document", insert: "create a CDR document based on " },
  { id: "rewrite", label: "Rewrite Selection", insert: "rewrite the selected file with clearer structure " },
  { id: "delete", label: "Delete File", insert: "delete file " },
] as const;

const MODES = ["Auto", "Research", "Agent"] as const;

function compactMarkdownForFile(value: string): string {
  return normalizeMarkdown(value)
    .replace(/\n\n(?=\s*[-*] )/g, "\n")
    .replace(/\n\n(?=\s*\d+\. )/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function inferCreateRequest(query: string, selectedFile: string | null) {
  const lower = query.toLowerCase();
  const wantsCreate = /\b(create|generate|draft|write|make|prepare)\b/.test(lower);
  const artifact = /\b(document|report|summary|cdr|file|note)\b/.test(lower);
  if (!wantsCreate || !artifact) return null;

  const sourceMatch = query.match(/(?:based on|from|for|of)\s+(?:the\s+)?(?:file\s+)?["']?([^"'\n]+?\.(?:pdf|docx|txt|md|xlsx|csv|probe))["']?/i);
  const folderMatch = query.match(/(?:in|inside|under)\s+(?:a\s+)?(?:folder|directory)\s+(?:called|named)?\s*["']?([^"'\n]+?)["']?(?:\.|$)/i);
  const namedMatch = query.match(/(?:called|named|as)\s+["']?([^"'\n]+?\.(?:md|txt|probe))["']?/i);

  const sourcePath = sourceMatch?.[1]?.trim() || selectedFile || "";
  const baseName = sourcePath ? sourcePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "document" : "document";
  const folder = folderMatch?.[1]?.trim().replace(/\/+$/, "") || "";
  const filename =
    namedMatch?.[1]?.trim() ||
    (lower.includes("cdr") ? `cdr-${slugify(baseName)}.md` : lower.includes("summary") ? `summary-${slugify(baseName)}.md` : `generated-${slugify(baseName)}.md`);
  const cleanFilename = filename.endsWith(".md") || filename.endsWith(".txt") || filename.endsWith(".probe") ? filename : `${filename}.md`;
  return {
    sourcePath,
    folder,
    outputPath: folder ? `${folder}/${cleanFilename}` : cleanFilename,
  };
}

function inferFileMutation(query: string, selectedFile: string | null) {
  const lower = query.toLowerCase();
  const sourceMatch = query.match(/(?:file\s+)?["']?([^"'\n]+?\.(?:pdf|docx|txt|md|xlsx|csv|probe))["']?/i);
  const path = sourceMatch?.[1]?.trim() || selectedFile || "";
  if (!path) return null;
  if (/\b(delete|remove)\b/.test(lower)) return { kind: "delete" as const, path };
  if (/\b(modify|edit|update|rewrite)\b/.test(lower)) return { kind: "modify" as const, path };
  return null;
}

function ToolStatusIcon({ status }: { status: ToolEvent["status"] }) {
  if (status === "done") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === "failed") return <XCircle className="h-3.5 w-3.5 text-red-600" />;
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />;
  return <Circle className="h-3.5 w-3.5 text-zinc-400" />;
}

function FileTreeNode({
  node,
  depth = 0,
  selectedPath,
  expanded,
  onToggle,
  onSelectFile,
}: {
  node: TreeNode;
  depth?: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "flex w-full items-center gap-2 py-1.5 pr-2 text-left text-sm",
          selectedPath === node.path
            ? "bg-zinc-900 text-white"
            : "text-zinc-700 hover:bg-zinc-50",
        )}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>
    );
  }

  const open = expanded.has(node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className="flex w-full items-center gap-2 py-1.5 pr-2 text-left text-sm text-zinc-800 hover:bg-zinc-50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Folder className="h-3.5 w-3.5 text-blue-600" />
        <span className="truncate">{node.name}</span>
      </button>
      {open &&
        (node.children ?? []).map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            expanded={expanded}
            onToggle={onToggle}
            onSelectFile={onSelectFile}
          />
        ))}
    </div>
  );
}

export function DocumentEditorIdeShell() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["/"]));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [viewerUrl, setViewerUrl] = useState("");
  const [loadingTree, setLoadingTree] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [chatQuery, setChatQuery] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [sessionId] = useState(() => crypto.randomUUID());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionPath, setMentionPath] = useState<string[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandFilter, setCommandFilter] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [agentMode, setAgentMode] = useState<(typeof MODES)[number]>("Auto");

  const selectedExt = useMemo(() => (selectedFile ? extOf(selectedFile) : ""), [selectedFile]);
  const isMarkdown = selectedExt === "md" || selectedExt === "markdown";
  const isTextLike = ["txt", "json", "yaml", "yml", "xml", "csv", "log", "probe"].includes(selectedExt);
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(selectedExt);
  const flatFiles = useMemo(() => flattenFiles(tree), [tree]);
  const mentionCurrentNodes = useMemo(() => nodeAtPath(tree, mentionPath), [tree, mentionPath]);
  const mentionItems = useMemo(
    () =>
      mentionCurrentNodes
        .filter((node) => !mentionFilter || node.name.toLowerCase().includes(mentionFilter.toLowerCase()))
        .slice(0, 10),
    [mentionCurrentNodes, mentionFilter],
  );
  const commandItems = useMemo(
    () => COMMANDS.filter((command) => command.label.toLowerCase().includes(commandFilter.toLowerCase())).slice(0, 8),
    [commandFilter],
  );
  const highlightedComposer = useMemo(() => mentionSegments(chatQuery, flatFiles), [chatQuery, flatFiles]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, [chatTurns, chatLoading]);

  const updateTurn = useCallback((turnId: string, updater: (turn: ChatTurn) => ChatTurn) => {
    setChatTurns((prev) => prev.map((turn) => (turn.id === turnId ? updater(turn) : turn)));
  }, []);

  const updateTool = useCallback((turnId: string, toolId: string, patch: Partial<ToolEvent>) => {
    updateTurn(turnId, (turn) => ({
      ...turn,
      tools: turn.tools.map((tool) => (tool.id === toolId ? { ...tool, ...patch } : tool)),
    }));
  }, [updateTurn]);

  const insertMention = useCallback((path: string) => {
    const input = chatInputRef.current;
    const value = chatQuery;
    const caret = input?.selectionStart ?? value.length;
    const at = value.lastIndexOf("@", caret - 1);
    const token = path.includes(" ") ? `@"${path}"` : `@${path}`;
    const before = at >= 0 ? value.slice(0, at) : `${value} `;
    const after = value.slice(caret);
    const next = `${before}${token} ${after}`.replace(/\s+$/g, " ");
    setChatQuery(next);
    setMentionOpen(false);
    setMentionFilter("");
    setMentionIndex(0);
    setMentionPath([]);
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
      const nextCaret = before.length + token.length + 1;
      chatInputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [chatQuery]);

  const insertCommand = useCallback((insert: string) => {
    const input = chatInputRef.current;
    const value = chatQuery;
    const caret = input?.selectionStart ?? value.length;
    const slash = value.lastIndexOf("/", caret - 1);
    const before = slash >= 0 ? value.slice(0, slash) : value;
    const after = value.slice(caret);
    const next = `${before}${insert}${after}`;
    setChatQuery(next);
    setCommandOpen(false);
    setCommandFilter("");
    setCommandIndex(0);
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
      const nextCaret = before.length + insert.length;
      chatInputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [chatQuery]);

  const syncComposerMenus = useCallback((value: string, caret: number) => {
    const at = value.lastIndexOf("@", caret - 1);
    const slash = value.lastIndexOf("/", caret - 1);
    if (at > slash && at >= 0) {
      const fragment = value.slice(at + 1, caret);
      if (!fragment.includes(" ") && !fragment.includes("\n")) {
        setMentionOpen(true);
        setCommandOpen(false);
        setMentionFilter(fragment.replace(/^"/, ""));
        setMentionIndex(0);
        if (!mentionOpen) setMentionPath([]);
        return;
      }
    }
    if (slash > at && slash >= 0) {
      const fragment = value.slice(slash + 1, caret);
      if (!fragment.includes(" ") && !fragment.includes("\n")) {
        setCommandOpen(true);
        setMentionOpen(false);
        setCommandFilter(fragment);
        setCommandIndex(0);
        return;
      }
    }
    setMentionOpen(false);
    setCommandOpen(false);
  }, [mentionOpen]);

  const loadTree = useCallback(async (wsId: string) => {
    setLoadingTree(true);
    setLoadError("");
    try {
      const build = async (path: string): Promise<TreeNode[]> => {
        const data = await listDocuments(wsId, path);
        const folders = await Promise.all(
          data.folders.map(async (folder) => ({
            path: folder.path,
            name: folder.name,
            type: "folder" as const,
            children: await build(`/${folder.path}`),
          })),
        );
        const files = data.files.map((file) => ({
          path: file.path,
          name: file.name,
          type: "file" as const,
        }));
        return [...folders, ...files];
      };

      setTree(await build("/"));
      setSelectedFile(null);
      setTextContent("");
      setViewerUrl("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load workspace files");
      setTree([]);
    } finally {
      setLoadingTree(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingTree(true);
      setLoadError("");
      try {
        const items = await listWorkspaces();
        if (cancelled) return;
        setWorkspaces(items);
        if (items[0]) {
          setWorkspaceId(items[0].id);
          await loadTree(items[0].id);
        } else {
          setLoadingTree(false);
        }
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load workspaces");
        setLoadingTree(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loadTree]);

  const handleSelectFile = useCallback(
    async (path: string) => {
      if (!workspaceId) return;
      setSelectedFile(path);
      setPreviewLoading(true);
      setTextContent("");
      setViewerUrl("");
      try {
        const ext = extOf(path);
        if (["md", "markdown", "txt", "json", "yaml", "yml", "xml", "csv", "log", "probe"].includes(ext)) {
          setTextContent(await getFileTextContent(workspaceId, path));
        } else {
          const { url } = await getDownloadUrl(workspaceId, path);
          if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
            setViewerUrl(`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`);
          } else {
            setViewerUrl(url);
          }
        }
      } catch (error) {
        setTextContent(error instanceof Error ? error.message : "Failed to load file");
      } finally {
        setPreviewLoading(false);
      }
    },
    [workspaceId],
  );

  async function handleAsk() {
    const query = chatQuery.trim();
    if (!query || !workspaceId || chatLoading) return;
    const turnId = crypto.randomUUID();
    const taggedContext = parseTaggedFilePaths(query, flatFiles);
    const primaryContext = taggedContext[0] || selectedFile;
    const createRequest = inferCreateRequest(query, primaryContext);
    const mutationRequest = createRequest ? null : inferFileMutation(query, primaryContext);
    const initialTools: ToolEvent[] = [
      {
        id: "retrieve",
        label: "Retrieve Workspace Context",
        detail: taggedContext.length > 0
          ? `Using tagged file context: ${taggedContext.join(", ")}`
          : selectedFile
            ? `Using selected file ${selectedFile}`
            : "Searching indexed workspace documents",
        status: "pending",
      },
    ];
    if (mutationRequest?.kind === "delete") {
      initialTools.push({
        id: "delete-file",
        label: "Delete File",
        detail: mutationRequest.path,
        status: "pending",
      });
    }
    if (mutationRequest?.kind === "modify") {
      initialTools.push({
        id: "write-file",
        label: "Modify File",
        detail: mutationRequest.path,
        status: "pending",
      });
    }
    if (createRequest) {
      if (createRequest.folder) {
        initialTools.push({
          id: "ensure-folder",
          label: "Ensure Output Folder",
          detail: createRequest.folder,
          status: "pending",
        });
      }
      initialTools.push({
        id: "write-file",
        label: "Create Generated File",
        detail: createRequest.outputPath,
        status: "pending",
      });
    }

    setChatTurns((prev) => [
      ...prev,
      {
        id: turnId,
        query,
        summary: "",
        message: "Working...",
        results: [],
        status: "running",
        tools: initialTools,
      },
    ]);
    setChatLoading(true);
    setChatQuery("");
    try {
      updateTool(turnId, "retrieve", { status: "running" });
      const contextPaths = [
        ...new Set([
          ...taggedContext,
          createRequest?.sourcePath,
          mutationRequest?.path,
          selectedFile || undefined,
        ].filter(Boolean) as string[]),
      ];
      const modeInstruction = agentMode === "Auto"
        ? "\n\nAgent mode: Auto. Keep the answer crisp and directly useful."
        : agentMode === "Research"
          ? "\n\nAgent mode: Research. Perform deep recursive retrieval and synthesis. Prefer a much more detailed answer with sections, evidence, assumptions, and implications."
          : "\n\nAgent mode: Agent. Decide whether file tools are needed and describe tool use clearly.";
      const scopedQuery = contextPaths.length > 0
        ? `${query}\n\nReferenced files:\n${contextPaths.map((path) => `- ${path}`).join("\n")}${modeInstruction}\n\nReturn a clean markdown answer with blank lines between sections and paragraphs.`
        : `${query}${modeInstruction}\n\nReturn a clean markdown answer with blank lines between sections and paragraphs.`;
      const response = await searchDocuments(workspaceId, scopedQuery, sessionId);
      updateTool(turnId, "retrieve", {
        status: "done",
        detail: response.results.length > 0 ? `${response.results.length} source result(s) retrieved` : "Search completed",
      });

      let summary = normalizeMarkdown(stripPlainSourceLines(response.summary || response.message));
      if (mutationRequest?.kind === "delete") {
        updateTool(turnId, "delete-file", { status: "running" });
        await deleteFile(workspaceId, mutationRequest.path);
        updateTool(turnId, "delete-file", { status: "done", detail: `Deleted ${mutationRequest.path}` });
        summary = `Deleted \`${mutationRequest.path}\`.\n\n${summary}`;
        await loadTree(workspaceId);
      }
      if (mutationRequest?.kind === "modify") {
        updateTool(turnId, "write-file", { status: "running" });
        const ext = extOf(mutationRequest.path);
        const canWriteBack = ["md", "markdown", "txt", "json", "yaml", "yml", "xml", "csv", "log", "probe"].includes(ext);
        const targetPath = canWriteBack
          ? mutationRequest.path
          : `${mutationRequest.path.replace(/\.[^.]+$/, "")}-modified.md`;
        const output = compactMarkdownForFile(summary);
        await writeTextFile(workspaceId, targetPath, output, targetPath.endsWith(".md") ? "text/markdown" : "text/plain");
        updateTool(turnId, "write-file", {
          status: "done",
          detail: canWriteBack ? `Updated ${targetPath}` : `Created editable companion ${targetPath}`,
        });
        summary = `${summary}\n\n---\n\n**Updated file:** \`${targetPath}\``;
        await loadTree(workspaceId);
      }
      if (createRequest) {
        if (createRequest.folder) {
          updateTool(turnId, "ensure-folder", { status: "running" });
          try {
            await createFolder(workspaceId, createRequest.folder, "/");
            updateTool(turnId, "ensure-folder", { status: "done", detail: createRequest.folder });
          } catch (error) {
            const msg = error instanceof Error ? error.message : "";
            if (msg.includes("409")) {
              updateTool(turnId, "ensure-folder", { status: "done", detail: `${createRequest.folder} already exists` });
            } else {
              throw error;
            }
          }
        }
        updateTool(turnId, "write-file", { status: "running" });
        const output = compactMarkdownForFile(
          `# ${createRequest.outputPath.split("/").pop()?.replace(/\.(md|txt|probe)$/i, "") || "Generated Document"}\n\n${summary}`,
        );
        await writeTextFile(workspaceId, createRequest.outputPath, output, "text/markdown");
        updateTool(turnId, "write-file", { status: "done", detail: `Created ${createRequest.outputPath}` });
        summary = `${summary}\n\n---\n\n**Created file:** \`${createRequest.outputPath}\``;
        await loadTree(workspaceId);
      }

      updateTurn(turnId, (turn) => ({
        ...turn,
        summary,
        message: response.message,
        results: response.results,
        status: "done",
      }));
    } catch (error) {
      updateTurn(turnId, (turn) => ({
        ...turn,
          summary: "",
          message: error instanceof Error ? error.message : "AI request failed",
          results: [],
          status: "failed",
          tools: turn.tools.map((tool) => (tool.status === "running" || tool.status === "pending" ? { ...tool, status: "failed" } : tool)),
      }));
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="grid h-[calc(100dvh-7.5rem)] min-h-0 grid-cols-[44px_280px_minmax(0,1fr)_380px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-r border-zinc-200 bg-zinc-50">
        <div className="flex h-full flex-col items-center gap-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-zinc-900 text-white">
            <FileSearch className="h-4 w-4" />
          </div>
          <div className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500">
            <MessageSquare className="h-4 w-4" />
          </div>
        </div>
      </div>

      <aside className="min-w-0 overflow-hidden border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Document Editor</p>
          <select
            value={workspaceId}
            onChange={(event) => {
              const next = event.target.value;
              setWorkspaceId(next);
              void loadTree(next);
            }}
            className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>
        <div className="h-[calc(100%-4.7rem)] overflow-y-auto py-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent">
          {loadingTree ? (
            <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading files...
            </div>
          ) : loadError ? (
            <div className="px-3 py-4 text-sm text-red-600">{loadError}</div>
          ) : tree.length === 0 ? (
            <div className="px-3 py-4 text-sm text-zinc-500">No files in this workspace yet.</div>
          ) : (
            tree.map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                selectedPath={selectedFile}
                expanded={expanded}
                onToggle={(path) =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                onSelectFile={(path) => void handleSelectFile(path)}
              />
            ))
          )}
        </div>
      </aside>

      <section className="min-w-0 overflow-hidden border-r border-zinc-200 bg-zinc-50">
        <div className="border-b border-zinc-200 bg-white px-4 py-2.5">
          <p className="truncate text-sm font-medium text-zinc-800">{selectedFile ?? "Select a file"}</p>
        </div>
        <div className="h-[calc(100%-2.75rem)] overflow-hidden">
          {!selectedFile ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Choose a workspace file to preview or edit.
            </div>
          ) : previewLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading file...
            </div>
          ) : isMarkdown ? (
            <div className="grid h-full grid-cols-2">
              <textarea
                value={textContent}
                onChange={(event) => setTextContent(event.target.value)}
                className="h-full w-full resize-none border-r border-zinc-200 bg-white p-4 font-mono text-sm text-zinc-800 outline-none"
              />
              <div className="h-full overflow-y-auto bg-white p-4 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent">
                <article className="prose prose-zinc max-w-none text-sm">
                  <ReactMarkdown>{textContent}</ReactMarkdown>
                </article>
              </div>
            </div>
          ) : isTextLike ? (
            <textarea
              value={textContent}
              onChange={(event) => setTextContent(event.target.value)}
              className="h-full w-full resize-none bg-white p-4 font-mono text-sm text-zinc-800 outline-none"
            />
          ) : isImage ? (
            <div className="flex h-full items-center justify-center bg-zinc-100 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={viewerUrl} alt={selectedFile} className="max-h-full max-w-full rounded-lg border border-zinc-200 bg-white" />
            </div>
          ) : (
            <iframe title={selectedFile} src={viewerUrl} className="h-full w-full border-0 bg-white" />
          )}
        </div>
      </section>

      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
        <div className="shrink-0 border-b border-zinc-200 px-4 py-2.5">
          <p className="text-sm font-semibold text-zinc-900">AI Chat</p>
          <p className="text-xs text-zinc-500">Uses the current workspace retrieval API.</p>
        </div>
        <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent">
          {chatTurns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 p-4 text-sm text-zinc-500">
              Ask about your workspace documents. Selecting a file adds it as context.
            </div>
          ) : (
            <div className="space-y-3">
              {chatTurns.map((turn) => (
                <div key={turn.id} className="space-y-2">
                  <div className="ml-auto max-w-[90%] rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white">
                    {turn.query}
                  </div>
                  {turn.tools.length > 0 && (
                    <div className="max-w-[95%] rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2">
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-blue-800">
                        <Wrench className="h-3.5 w-3.5" />
                        Agent Tools
                      </div>
                      <div className="space-y-1.5">
                        {turn.tools.map((tool) => (
                          <div key={tool.id} className="flex items-start gap-2 rounded-lg bg-white/80 px-2 py-1.5 text-xs">
                            <ToolStatusIcon status={tool.status} />
                            <div className="min-w-0">
                              <p className="font-medium text-zinc-800">{tool.label}</p>
                              <p className="truncate text-zinc-500">{tool.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="max-w-[95%] rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-700">
                    {turn.status === "running" && !turn.summary ? (
                      <div className="flex items-center gap-2 text-zinc-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating answer...
                      </div>
                    ) : turn.summary ? (
                      <article className="prose prose-zinc max-w-none text-xs leading-5 prose-headings:mb-1.5 prose-headings:mt-3 prose-headings:text-sm prose-headings:font-semibold prose-p:my-2 prose-p:leading-5 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:font-semibold prose-hr:my-3">
                        <ReactMarkdown>{turn.summary}</ReactMarkdown>
                      </article>
                    ) : (
                      turn.message
                    )}
                    {turn.results.length > 0 && (
                      <div className="mt-2 border-t border-zinc-200 pt-2">
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Sources</p>
                        <div className="flex flex-wrap gap-1.5">
                          {turn.results.map((result) => {
                            const path = sourcePath(result.path);
                            return (
                              <button
                                key={result.path}
                                type="button"
                                onClick={() => void handleSelectFile(path)}
                                className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 hover:bg-zinc-100"
                                title={path}
                              >
                                <FileText className="h-3 w-3 shrink-0" />
                                <span className="truncate">{path}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="relative shrink-0 border-t border-zinc-200 bg-white p-3">
          {mentionOpen && mentionItems.length > 0 && (
            <div className="absolute bottom-[7.2rem] left-3 right-3 z-30 max-h-60 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">
                  {mentionPath.length ? mentionPath.join(" / ") : "Workspace Files"}
                </span>
                {mentionPath.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMentionPath((prev) => prev.slice(0, -1));
                      setMentionIndex(0);
                    }}
                    className="text-[11px] text-zinc-500 hover:text-zinc-900"
                  >
                    Back
                  </button>
                )}
              </div>
              {mentionItems.map((node, index) => (
                <button
                  key={node.path}
                  type="button"
                  onClick={() => {
                    if (node.type === "folder") {
                      setMentionPath((prev) => [...prev, node.name]);
                      setMentionFilter("");
                      setMentionIndex(0);
                    } else {
                      insertMention(node.path);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                    mentionIndex === index ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50",
                  )}
                >
                  {node.type === "folder" ? <Folder className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate">{node.name}</span>
                  {node.type === "folder" && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />}
                </button>
              ))}
            </div>
          )}
          {commandOpen && commandItems.length > 0 && (
            <div className="absolute bottom-[7.2rem] left-3 right-3 z-30 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
              <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-400">Commands</div>
              {commandItems.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  onClick={() => insertCommand(command.insert)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                    commandIndex === index ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50",
                  )}
                >
                  <Slash className="h-3.5 w-3.5 shrink-0" />
                  <span>{command.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm focus-within:border-zinc-300 focus-within:shadow-[0_0_0_3px_rgba(24,24,27,0.06)]">
            <div className="relative min-h-[3.25rem]">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-sm leading-5 text-zinc-900"
              >
                {highlightedComposer.map((segment, index) =>
                  segment.highlight ? (
                    <span key={index} className="rounded-md bg-blue-100 px-1 text-blue-800">
                      {segment.text}
                    </span>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
                {"\n"}
              </div>
              <textarea
                ref={chatInputRef}
                value={chatQuery}
                onChange={(event) => {
                  const value = event.target.value;
                  const caret = event.target.selectionStart ?? value.length;
                  setChatQuery(value);
                  syncComposerMenus(value, caret);
                }}
                onKeyUp={(event) => syncComposerMenus(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                onClick={(event) => syncComposerMenus(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
                onKeyDown={(event) => {
                  if (mentionOpen && mentionItems.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionIndex((prev) => Math.min(prev + 1, mentionItems.length - 1));
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionIndex((prev) => Math.max(prev - 1, 0));
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      const node = mentionItems[mentionIndex];
                      if (node.type === "folder") {
                        setMentionPath((prev) => [...prev, node.name]);
                        setMentionFilter("");
                        setMentionIndex(0);
                      } else {
                        insertMention(node.path);
                      }
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setMentionOpen(false);
                      setMentionPath([]);
                      return;
                    }
                  }
                  if (commandOpen && commandItems.length > 0) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setCommandIndex((prev) => (prev + 1) % commandItems.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setCommandIndex((prev) => (prev - 1 + commandItems.length) % commandItems.length);
                      return;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      event.preventDefault();
                      insertCommand(commandItems[commandIndex].insert);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setCommandOpen(false);
                      return;
                    }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleAsk();
                  }
                }}
                rows={2}
                placeholder="Ask AI... use @ for files, / for commands"
                className="relative z-10 max-h-24 min-h-[3.25rem] w-full resize-none bg-transparent text-sm leading-5 text-transparent caret-zinc-900 outline-none placeholder:text-zinc-400 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300"
              />
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-zinc-100 pt-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const input = chatInputRef.current;
                    const caret = input?.selectionStart ?? chatQuery.length;
                    const next = `${chatQuery.slice(0, caret)}@${chatQuery.slice(caret)}`;
                    setChatQuery(next);
                    setMentionOpen(true);
                    setMentionPath([]);
                    setMentionFilter("");
                    setMentionIndex(0);
                    requestAnimationFrame(() => {
                      chatInputRef.current?.focus();
                      chatInputRef.current?.setSelectionRange(caret + 1, caret + 1);
                    });
                  }}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  title="Tag file context"
                >
                  <AtSign className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const input = chatInputRef.current;
                    const caret = input?.selectionStart ?? chatQuery.length;
                    const next = `${chatQuery.slice(0, caret)}/${chatQuery.slice(caret)}`;
                    setChatQuery(next);
                    setCommandOpen(true);
                    setCommandFilter("");
                    setCommandIndex(0);
                    requestAnimationFrame(() => {
                      chatInputRef.current?.focus();
                      chatInputRef.current?.setSelectionRange(caret + 1, caret + 1);
                    });
                  }}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  title="Open command palette"
                >
                  <Slash className="h-3.5 w-3.5" />
                </button>
                <select
                  value={agentMode}
                  onChange={(event) => setAgentMode(event.target.value as (typeof MODES)[number])}
                  className="h-7 rounded-lg border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-medium text-zinc-600 outline-none hover:bg-zinc-100"
                  title="Agent mode"
                >
                  {MODES.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleAsk}
                disabled={!chatQuery.trim() || chatLoading}
                className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
              >
                {chatLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
