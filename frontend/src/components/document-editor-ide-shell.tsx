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
  Plus,
  RefreshCcw,
  SendHorizontal,
  Slash,
  Trash2,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocumentMarkdownLiveEditor } from "@/components/document-editor/document-markdown-live-editor";
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
  deleteFolder,
  uploadFilesWithProgress,
  getKnowledgeBaseStatus,
  listFileComments,
  createFileComment,
  replyToFileComment,
  updateFileCommentStatus,
  type KnowledgeBaseStatus,
  type DocumentComment,
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
  diff?: string;
};

type SaveStatus = "saved" | "dirty" | "saving" | "error";
type ExplorerMode = "files" | "comments";

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

function parentFolder(path: string | null): string {
  if (!path) return "/";
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function normalizeFolder(path: string): string {
  const clean = path.trim().replace(/^\/+|\/+$/g, "");
  return clean || "/";
}

function simpleLineDiff(before: string, after: string): string {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const max = Math.max(oldLines.length, newLines.length);
  const changed: string[] = [];
  for (let i = 0; i < max; i += 1) {
    if (oldLines[i] === newLines[i]) continue;
    if (oldLines[i] !== undefined) changed.push(`- ${oldLines[i]}`);
    if (newLines[i] !== undefined) changed.push(`+ ${newLines[i]}`);
    if (changed.length > 24) {
      changed.push("...");
      break;
    }
  }
  return changed.join("\n") || "No textual diff.";
}

function findMarkdownSectionRange(content: string, query: string): { start: number; end: number } | null {
  const lines = content.split("\n");
  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/^#{1,3}\s+/.test(line)) continue;
    const lower = line.toLowerCase();
    if (!keywords.some((word) => lower.includes(word))) continue;
    const level = line.match(/^#+/)?.[0].length ?? 1;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const nextLevel = lines[j].match(/^#+/)?.[0].length;
      if (nextLevel && nextLevel <= level) {
        end = j;
        break;
      }
    }
    return { start: i, end };
  }
  return null;
}

function applyTargetedMarkdownEdit(original: string, query: string, generated: string): string {
  const sectionRange = findMarkdownSectionRange(original, query);
  const cleanGenerated = compactMarkdownForFile(generated);
  if (!sectionRange) return cleanGenerated;
  const lines = original.split("\n");
  const replacement = cleanGenerated.split("\n");
  return [
    ...lines.slice(0, sectionRange.start),
    ...replacement,
    ...lines.slice(sectionRange.end),
  ].join("\n");
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

function extractResolvedMentions(value: string, validFiles: string[]): string[] {
  const valid = new Set(validFiles);
  const out: string[] = [];
  const re = /@"([^"]+)"|@([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    const raw = match[1] || match[2] || "";
    const clean = raw.replace(/[),.;:]+$/, "");
    if (valid.has(clean)) out.push(clean);
  }
  return [...new Set(out)];
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

const MUTABLE_FILE_EXT_RE = /\.(?:pdf|docx|txt|md|markdown|xlsx|csv|probe)$/i;

function resolveMutationPath(candidate: string, flatFiles: string[]): string {
  const stripped = candidate.replace(/^@/, "").trim();
  if (!stripped) return candidate;
  if (flatFiles.includes(stripped)) return stripped;
  const bySuffix = flatFiles.filter((p) => p === stripped || p.endsWith(`/${stripped}`));
  if (bySuffix.length === 1) return bySuffix[0];
  const base = stripped.split("/").pop() ?? stripped;
  const byBasename = flatFiles.filter((p) => (p.split("/").pop() ?? p) === base);
  if (byBasename.length === 1) return byBasename[0];
  return stripped;
}

/** Lines that express edit/delete intent, or the last paragraph — avoids matching pasted paths above the real ask. */
function mutationIntentSlice(query: string): string {
  const intentLines = query
    .split("\n")
    .filter((line) => /\b(edit|modify|update|rewrite|delete|remove)\b/i.test(line));
  if (intentLines.length > 0) return intentLines.join("\n");
  const lastPara = query.lastIndexOf("\n\n");
  if (lastPara >= 0) return query.slice(lastPara + 2).trim() || query;
  return query;
}

function pickTaggedMutationTarget(taggedPaths: string[], slice: string, isModify: boolean): string | null {
  const tagged = taggedPaths.filter((p) => MUTABLE_FILE_EXT_RE.test(p));
  if (tagged.length === 0) return null;
  const sliceLower = slice.toLowerCase();
  const mentioned = tagged.filter((p) => {
    const base = (p.split("/").pop() ?? p).toLowerCase();
    return sliceLower.includes(p.toLowerCase()) || (base.length > 0 && sliceLower.includes(base));
  });
  if (mentioned.length === 1) return mentioned[0];
  if (tagged.length === 1) return tagged[0];
  if (isModify) {
    const md = tagged.filter((p) => /\.(md|markdown)$/i.test(p));
    if (md.length === 1) return md[0];
    if (md.length > 1) {
      const hit = md.find((p) => sliceLower.includes((p.split("/").pop() ?? "").toLowerCase()));
      return hit ?? md[0];
    }
  }
  return tagged[0];
}

function inferFileMutation(
  query: string,
  taggedPaths: string[],
  selectedFile: string | null,
  flatFiles: string[],
) {
  const lower = query.toLowerCase();
  const isDelete = /\b(delete|remove)\b/.test(lower);
  const isModify = /\b(modify|edit|update|rewrite)\b/.test(lower);
  if (!isDelete && !isModify) return null;

  const slice = mutationIntentSlice(query);
  let rawPath = pickTaggedMutationTarget(taggedPaths, slice, isModify);
  if (!rawPath) {
    const sourceMatch = slice.match(/(?:file\s+)?["']?([^"'\n]+?\.(?:pdf|docx|txt|md|markdown|xlsx|csv|probe))["']?/i);
    rawPath = sourceMatch?.[1]?.trim() || selectedFile || "";
  }
  if (!rawPath) return null;

  const path = resolveMutationPath(rawPath, flatFiles);
  if (isDelete) return { kind: "delete" as const, path };
  if (isModify) return { kind: "modify" as const, path };
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
  selectedFolder,
  expanded,
  onToggle,
  onSelectFile,
  onSelectFolder,
}: {
  node: TreeNode;
  depth?: number;
  selectedPath: string | null;
  selectedFolder: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (path: string) => void;
  onSelectFolder: (path: string) => void;
}) {
  if (node.type === "file") {
    return (
      <button
        type="button"
        onClick={() => onSelectFile(node.path)}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg py-1.5 pr-2 text-left text-sm transition-colors",
          selectedPath === node.path
            ? "border border-zinc-800 bg-zinc-900 text-white"
            : "text-zinc-700 hover:bg-zinc-100",
        )}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
    );
  }

  const open = expanded.has(node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelectFolder(node.path);
          onToggle(node.path);
        }}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg py-1.5 pr-2 text-left text-sm transition-colors hover:bg-zinc-100",
          selectedFolder === node.path ? "bg-blue-50 text-blue-700" : "text-zinc-800",
        )}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Folder className="h-3.5 w-3.5 text-blue-600" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {open &&
        (node.children ?? []).map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            selectedFolder={selectedFolder}
            expanded={expanded}
            onToggle={onToggle}
            onSelectFile={onSelectFile}
            onSelectFolder={onSelectFolder}
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
  const [selectedFolder, setSelectedFolder] = useState("/");
  const [textContent, setTextContent] = useState("");
  const [viewerUrl, setViewerUrl] = useState("");
  const [loadingTree, setLoadingTree] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [uploadStatus, setUploadStatus] = useState("");
  const [kbStatus, setKbStatus] = useState<KnowledgeBaseStatus | null>(null);
  const [comments, setComments] = useState<DocumentComment[]>([]);
  const [commentStatus, setCommentStatus] = useState("");
  const [explorerMode, setExplorerMode] = useState<ExplorerMode>("files");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatQuery, setChatQuery] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [sessionId] = useState(() => crypto.randomUUID());
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const mentionAtAnchorRef = useRef(-1);
  const mentionMenuKeyRef = useRef("");
  const commandAnchorRef = useRef(-1);
  const commandMenuKeyRef = useRef("");
  const mentionListRef = useRef<HTMLDivElement>(null);
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
  const isLiveEditable = isMarkdown || selectedExt === "txt" || selectedExt === "probe";
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
  const composerMentionChips = useMemo(() => extractResolvedMentions(chatQuery, flatFiles), [chatQuery, flatFiles]);

  useEffect(() => {
    if (!mentionOpen || mentionItems.length === 0) return;
    const root = mentionListRef.current;
    const el = root?.querySelector(`[data-mention-idx="${mentionIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [mentionIndex, mentionItems.length, mentionOpen]);

  useEffect(() => {
    setMentionIndex((i) => Math.min(i, Math.max(0, mentionItems.length - 1)));
  }, [mentionItems.length]);

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

  const refreshKnowledgeStatus = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setKbStatus(await getKnowledgeBaseStatus(workspaceId));
    } catch {
      setKbStatus(null);
    }
  }, [workspaceId]);

  const loadFileComments = useCallback(async (path: string) => {
    if (!workspaceId) return;
    try {
      setComments(await listFileComments(workspaceId, path));
      setCommentStatus("");
    } catch (error) {
      setComments([]);
      setCommentStatus(error instanceof Error ? error.message : "Failed to load comments");
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshKnowledgeStatus();
    const timer = setInterval(() => void refreshKnowledgeStatus(), 5000);
    return () => clearInterval(timer);
  }, [refreshKnowledgeStatus]);

  const insertMention = useCallback((path: string) => {
    const input = chatInputRef.current;
    const value = chatQuery;
    const caret = input?.selectionStart ?? value.length;
    const at = value.lastIndexOf("@", caret - 1);
    const token = path.includes(" ") ? `@"${path}"` : `@${path}`;
    const before = at >= 0 ? value.slice(0, at) : `${value} `;
    const after = value.slice(caret);
    const next = `${before}${token}  ${after}`.replace(/\s+$/g, " ");
    setChatQuery(next);
    setMentionOpen(false);
    setMentionFilter("");
    setMentionIndex(0);
    setMentionPath([]);
    mentionAtAnchorRef.current = -1;
    mentionMenuKeyRef.current = "";
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
      const nextCaret = before.length + token.length + 2;
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
        if (at !== mentionAtAnchorRef.current) {
          mentionAtAnchorRef.current = at;
          setMentionPath([]);
        }
        const key = `${at}|${fragment}`;
        if (key !== mentionMenuKeyRef.current) {
          mentionMenuKeyRef.current = key;
          setMentionIndex(0);
        }
        setMentionOpen(true);
        setCommandOpen(false);
        setMentionFilter(fragment.replace(/^"/, ""));
        return;
      }
    }
    if (slash > at && slash >= 0) {
      const fragment = value.slice(slash + 1, caret);
      if (!fragment.includes(" ") && !fragment.includes("\n")) {
        if (slash !== commandAnchorRef.current) {
          commandAnchorRef.current = slash;
        }
        const ckey = `${slash}|${fragment}`;
        if (ckey !== commandMenuKeyRef.current) {
          commandMenuKeyRef.current = ckey;
          setCommandIndex(0);
        }
        setCommandOpen(true);
        setMentionOpen(false);
        setCommandFilter(fragment);
        return;
      }
    }
    setMentionOpen(false);
    setCommandOpen(false);
    mentionAtAnchorRef.current = -1;
    mentionMenuKeyRef.current = "";
    commandAnchorRef.current = -1;
    commandMenuKeyRef.current = "";
  }, []);

  const loadTree = useCallback(async (wsId: string, options?: { preserveSelection?: boolean }) => {
    setLoadingTree(true);
    setLoadError("");
    const preserveSelection = options?.preserveSelection ?? false;
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
      if (!preserveSelection) {
        setSelectedFile(null);
        setSelectedFolder("/");
        setTextContent("");
        setViewerUrl("");
        setComments([]);
        setCommentStatus("");
        setSaveStatus("saved");
      }
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
      setSelectedFolder(parentFolder(path));
      setPreviewLoading(true);
      setTextContent("");
      setViewerUrl("");
      setComments([]);
      setCommentStatus("");
      setSaveStatus("saved");
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
        await loadFileComments(path);
      } catch (error) {
        setTextContent(error instanceof Error ? error.message : "Failed to load file");
      } finally {
        setPreviewLoading(false);
      }
    },
    [loadFileComments, workspaceId],
  );

  const saveSelectedFile = useCallback(async (contentOverride?: string) => {
    if (!workspaceId || !selectedFile) return;
    setSaveStatus("saving");
    try {
      const contentType = selectedFile.endsWith(".md") || selectedFile.endsWith(".markdown") ? "text/markdown" : "text/plain";
      await writeTextFile(workspaceId, selectedFile, compactMarkdownForFile(contentOverride ?? textContent), contentType);
      setSaveStatus("saved");
      await refreshKnowledgeStatus();
    } catch {
      setSaveStatus("error");
    }
  }, [refreshKnowledgeStatus, selectedFile, textContent, workspaceId]);

  const handleEditorChange = useCallback((next: string) => {
    setTextContent(next);
    setSaveStatus("dirty");
  }, []);

  const handleMarkdownSave = useCallback(() => {
    void saveSelectedFile();
  }, [saveSelectedFile]);

  const handleCreateComment = useCallback(async (anchorText: string) => {
    if (!workspaceId || !selectedFile) return;
    const body = window.prompt("Comment on this section")?.trim();
    if (!body) return;
    try {
      const comment = await createFileComment(workspaceId, selectedFile, {
        body,
        anchor_text: anchorText || null,
      });
      setComments((prev) => [...prev, comment]);
      setCommentStatus("");
    } catch (error) {
      setCommentStatus(error instanceof Error ? error.message : "Failed to create comment");
    }
  }, [selectedFile, workspaceId]);

  const handleReplyComment = useCallback(async (commentId: string, body: string) => {
    if (!workspaceId || !selectedFile) return;
    try {
      const entry = await replyToFileComment(workspaceId, selectedFile, commentId, body);
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId ? { ...comment, thread: [...comment.thread, entry] } : comment,
        ),
      );
      setCommentStatus("");
    } catch (error) {
      setCommentStatus(error instanceof Error ? error.message : "Failed to add reply");
    }
  }, [selectedFile, workspaceId]);

  const handleToggleCommentStatus = useCallback(async (commentId: string, status: "open" | "resolved") => {
    if (!workspaceId || !selectedFile) return;
    try {
      const updated = await updateFileCommentStatus(workspaceId, selectedFile, commentId, status);
      setComments((prev) => prev.map((comment) => (comment.id === commentId ? updated : comment)));
      setCommentStatus("");
    } catch (error) {
      setCommentStatus(error instanceof Error ? error.message : "Failed to update comment");
    }
  }, [selectedFile, workspaceId]);

  const uploadIntoCurrentFolder = useCallback((files: FileList | File[]) => {
    if (!workspaceId || files.length === 0) return;
    const target = "uploads";
    setUploadStatus(`Uploading ${files.length} file(s)...`);
    const { promise } = uploadFilesWithProgress(workspaceId, Array.from(files), target, "uploaded", (loaded, total) => {
      if (total > 0) setUploadStatus(`Uploading ${Math.round((loaded / total) * 100)}%`);
    });
    promise
      .then(async () => {
        setUploadStatus("Upload complete");
        await loadTree(workspaceId, { preserveSelection: true });
        await refreshKnowledgeStatus();
        setTimeout(() => setUploadStatus(""), 1800);
      })
      .catch((error) => {
        setUploadStatus(error instanceof Error ? error.message : "Upload failed");
      });
  }, [loadTree, refreshKnowledgeStatus, selectedFile, selectedFolder, workspaceId]);

  const createFileFromPrompt = useCallback(async () => {
    if (!workspaceId) return;
    const name = window.prompt("New file name", "untitled.md")?.trim();
    if (!name) return;
    const folder = normalizeFolder(selectedFolder);
    const path = folder === "/" ? name : `${folder}/${name}`;
    await writeTextFile(workspaceId, path, "# Untitled\n\n", name.endsWith(".md") ? "text/markdown" : "text/plain");
    await loadTree(workspaceId, { preserveSelection: true });
    await refreshKnowledgeStatus();
    await handleSelectFile(path);
  }, [handleSelectFile, loadTree, refreshKnowledgeStatus, selectedFolder, workspaceId]);

  const createFolderFromPrompt = useCallback(async () => {
    if (!workspaceId) return;
    const name = window.prompt("New folder name")?.trim();
    if (!name) return;
    await createFolder(workspaceId, name, normalizeFolder(selectedFolder));
    await loadTree(workspaceId, { preserveSelection: true });
    await refreshKnowledgeStatus();
  }, [loadTree, refreshKnowledgeStatus, selectedFolder, workspaceId]);

  const deleteSelectedItem = useCallback(async () => {
    if (!workspaceId) return;
    if (selectedFile) {
      if (!window.confirm(`Delete ${selectedFile}?`)) return;
      await deleteFile(workspaceId, selectedFile);
      setSelectedFile(null);
      setTextContent("");
      setComments([]);
      setCommentStatus("");
      await loadTree(workspaceId, { preserveSelection: true });
      await refreshKnowledgeStatus();
      return;
    }
    if (selectedFolder && selectedFolder !== "/") {
      if (!window.confirm(`Delete folder ${selectedFolder}?`)) return;
      await deleteFolder(workspaceId, selectedFolder);
      setSelectedFolder("/");
      await loadTree(workspaceId, { preserveSelection: true });
      await refreshKnowledgeStatus();
    }
  }, [loadTree, refreshKnowledgeStatus, selectedFile, selectedFolder, workspaceId]);

  async function handleAsk() {
    const query = chatQuery.trim();
    if (!query || !workspaceId || chatLoading) return;
    const turnId = crypto.randomUUID();
    const taggedContext = parseTaggedFilePaths(query, flatFiles);
    const primaryContext = taggedContext[0] || selectedFile;
    const createRequest = inferCreateRequest(query, primaryContext);
    const mutationRequest = createRequest ? null : inferFileMutation(query, taggedContext, primaryContext, flatFiles);
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
        await loadTree(workspaceId, { preserveSelection: true });
        await refreshKnowledgeStatus();
      }
      if (mutationRequest?.kind === "modify") {
        updateTool(turnId, "write-file", { status: "running" });
        const ext = extOf(mutationRequest.path);
        const canWriteBack = ["md", "markdown", "txt", "json", "yaml", "yml", "xml", "csv", "log", "probe"].includes(ext);
        const targetPath = canWriteBack
          ? mutationRequest.path
          : `${mutationRequest.path.replace(/\.[^.]+$/, "")}-modified.md`;
        const original = canWriteBack ? await getFileTextContent(workspaceId, targetPath) : "";
        const output = canWriteBack
          ? applyTargetedMarkdownEdit(original, query, summary)
          : compactMarkdownForFile(summary);
        const diff = simpleLineDiff(original, output);
        await writeTextFile(workspaceId, targetPath, output, targetPath.endsWith(".md") ? "text/markdown" : "text/plain");
        updateTool(turnId, "write-file", {
          status: "done",
          detail: canWriteBack ? `Updated ${targetPath}` : `Created editable companion ${targetPath}`,
          diff,
        });
        if (selectedFile === targetPath) {
          setTextContent(output);
          setSaveStatus("saved");
        }
        summary = `${summary}\n\n---\n\n**Updated file:** \`${targetPath}\``;
        await loadTree(workspaceId, { preserveSelection: true });
        await refreshKnowledgeStatus();
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
        await loadTree(workspaceId, { preserveSelection: true });
        await refreshKnowledgeStatus();
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
    <div className="relative grid h-[calc(100dvh-7.5rem)] min-h-0 grid-cols-[44px_280px_minmax(0,1fr)_380px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-r border-zinc-200 bg-zinc-50">
        <div className="flex h-full flex-col items-center gap-2 py-2">
          <button
            type="button"
            onClick={() => setExplorerMode("files")}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg transition-colors",
              explorerMode === "files" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
            )}
            title="Files"
          >
            <FileSearch className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setExplorerMode("comments")}
            className={cn(
              "relative grid h-8 w-8 place-items-center rounded-lg transition-colors",
              explorerMode === "comments" ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
            )}
            title="Comments"
          >
            <MessageSquare className="h-4 w-4" />
            {comments.length > 0 && (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
            )}
          </button>
        </div>
      </div>

      <aside
        className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-zinc-200 bg-white"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          uploadIntoCurrentFolder(event.dataTransfer.files);
        }}
      >
        <div className="shrink-0 border-b border-zinc-200 bg-gradient-to-b from-zinc-50 to-white px-3 py-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 shrink">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
                {explorerMode === "files" ? "Document Editor" : "Comment History"}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                {explorerMode === "files" ? `${flatFiles.length} file${flatFiles.length === 1 ? "" : "s"} indexed locally` : selectedFile ?? "Select a file"}
              </p>
            </div>
            {explorerMode === "files" && (
              <div className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-sm">
              <button type="button" onClick={createFileFromPrompt} className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" title="New file">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={createFolderFromPrompt} className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" title="New folder">
                <Folder className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" title="Upload files">
                <Upload className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={deleteSelectedItem} className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600" title="Delete selected">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => workspaceId && loadTree(workspaceId, { preserveSelection: true })} className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" title="Refresh">
                <RefreshCcw className="h-3.5 w-3.5" />
              </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) uploadIntoCurrentFolder(event.target.files);
              event.target.value = "";
            }}
          />
          {explorerMode === "files" && (
            <>
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
          <div className="mt-2 rounded-xl border border-dashed border-zinc-200 bg-white/70 px-2.5 py-2 text-[11px] text-zinc-500">
            Drop files here to upload to <span className="font-medium text-zinc-700">uploads/</span>
            {uploadStatus && <span className="ml-1 text-blue-600">{uploadStatus}</span>}
          </div>
            </>
          )}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-white py-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent">
          {explorerMode === "files" ? (
            loadingTree ? (
              <div className="mx-3 mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading files...
              </div>
            ) : loadError ? (
              <div className="mx-3 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-4 text-sm text-red-600">{loadError}</div>
            ) : tree.length === 0 ? (
              <div className="mx-3 mt-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                No files in this workspace yet. Drop files above to start.
              </div>
            ) : (
              <div className="px-1">
                {tree.map((node) => (
                  <FileTreeNode
                    key={node.path}
                    node={node}
                    selectedPath={selectedFile}
                    selectedFolder={selectedFolder}
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
                    onSelectFolder={(path) => {
                      setSelectedFolder(path);
                      setSelectedFile(null);
                      setTextContent("");
                      setViewerUrl("");
                      setComments([]);
                      setCommentStatus("");
                    }}
                  />
                ))}
              </div>
            )
          ) : (
            <div className="space-y-2 p-3">
              {!selectedFile ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                  Select a file to see its comment history.
                </div>
              ) : comments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-500">
                  No comments on this file yet. Select text in the editor and click Comment.
                </div>
              ) : (
                comments.map((comment) => (
                  <div key={comment.id} className="rounded-xl border border-zinc-200 bg-white p-3 text-xs shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-800">{comment.created_by.name || comment.created_by.email}</p>
                        <p className="text-[10px] text-zinc-400">{new Date(comment.created_at).toLocaleString()}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          comment.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                        )}
                      >
                        {comment.status}
                      </span>
                    </div>
                    {comment.anchor_text && (
                      <blockquote className="mt-2 line-clamp-4 border-l-2 border-blue-200 pl-2 text-[11px] leading-4 text-zinc-500">
                        {comment.anchor_text}
                      </blockquote>
                    )}
                    <div className="mt-2 space-y-1.5">
                      {comment.thread.map((entry) => (
                        <div key={entry.id} className="rounded-lg bg-zinc-50 px-2 py-1.5">
                          <p className="text-[11px] font-medium text-zinc-600">{entry.created_by.name || entry.created_by.email}</p>
                          <p className="whitespace-pre-wrap leading-4 text-zinc-700">{entry.body}</p>
                        </div>
                      ))}
                    </div>
                    {comment.resolved_by && (
                      <p className="mt-2 text-[10px] text-zinc-400">
                        Resolved by {comment.resolved_by.name || comment.resolved_by.email}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refreshKnowledgeStatus()}
          className={cn(
            "m-3 mt-2 shrink-0 rounded-xl border px-3 py-2 text-left text-[11px] leading-4 shadow-sm transition-colors",
            kbStatus?.knowledge_base.state === "error"
              ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              : kbStatus?.knowledge_base.state === "indexing"
                ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
          )}
          title="Refresh knowledge base status"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="font-semibold">Knowledge Base</span>
            <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px]">{kbStatus?.knowledge_base.state ?? "unknown"}</span>
          </span>
          <span className="mt-1 block text-[10px] opacity-80">
            GCS {kbStatus?.sync.state ?? "unknown"} · queue {kbStatus?.knowledge_base.queue_depth ?? 0} · chunks {kbStatus?.knowledge_base.indexed_chunk_count ?? 0}
          </span>
        </button>
      </aside>

      <section className="min-w-0 overflow-hidden border-r border-zinc-200 bg-zinc-50">
        <div className="h-full overflow-hidden">
          {!selectedFile ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              Choose a workspace file to preview or edit.
            </div>
          ) : previewLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading file...
            </div>
          ) : isLiveEditable ? (
            <DocumentMarkdownLiveEditor
              path={selectedFile}
              content={textContent}
              saveStatus={saveStatus}
              comments={comments}
              workspaceId={workspaceId}
              onWorkspaceFilesChanged={() => {
                void loadTree(workspaceId, { preserveSelection: true });
                void refreshKnowledgeStatus();
              }}
              onChange={handleEditorChange}
              onSave={handleMarkdownSave}
              onCreateComment={handleCreateComment}
              onReplyComment={handleReplyComment}
              onToggleCommentStatus={handleToggleCommentStatus}
            />
          ) : isTextLike ? (
            <div className="flex h-full min-h-0 flex-col bg-white">
              <div className="shrink-0 border-b border-zinc-200 px-4 py-2.5">
                <p className="truncate text-sm font-medium text-zinc-800">{selectedFile}</p>
              </div>
              <textarea
                value={textContent}
                onChange={(event) => {
                  setTextContent(event.target.value);
                  setSaveStatus("dirty");
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                    event.preventDefault();
                    void saveSelectedFile();
                  }
                }}
                className="min-h-0 flex-1 resize-none bg-white p-4 font-mono text-sm text-zinc-800 outline-none"
              />
            </div>
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
          <div>
            <p className="text-sm font-semibold text-zinc-900">AI Chat</p>
            <p className="text-xs text-zinc-500">Uses the current workspace retrieval API.</p>
          </div>
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
                  <div className="dark-bubble ml-auto max-w-[90%] rounded-xl bg-zinc-900 px-3 py-2 text-sm text-white">
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
                              {tool.diff && (
                                <pre className="dark-bubble mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md bg-zinc-950 p-2 font-mono text-[10px] leading-4 text-zinc-100 [scrollbar-width:thin]">
                                  {tool.diff}
                                </pre>
                              )}
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
                      <article className="prose prose-zinc max-w-none cursor-text text-xs leading-5 prose-headings:mb-1.5 prose-headings:mt-3 prose-headings:text-sm prose-headings:font-semibold prose-p:my-2 prose-p:leading-5 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-strong:font-semibold prose-hr:my-3 prose-table:block prose-table:max-w-full prose-th:border prose-th:border-zinc-200 prose-th:px-2 prose-th:py-1 prose-td:border prose-td:border-zinc-200 prose-td:px-2 prose-td:py-1">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            table: ({ children }) => (
                              <div className="my-2 max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
                                <table className="min-w-max border-collapse text-left text-xs">{children}</table>
                              </div>
                            ),
                            pre: ({ children }) => (
                              <div className="my-2 max-w-full overflow-x-auto rounded-md bg-zinc-100 p-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
                                <pre className="m-0 whitespace-pre font-mono text-[11px] leading-4 text-zinc-800">{children}</pre>
                              </div>
                            ),
                          }}
                        >
                          {turn.summary}
                        </ReactMarkdown>
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
            <div
              ref={mentionListRef}
              className="absolute bottom-[6.25rem] left-3 right-3 z-30 max-h-60 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300"
            >
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
                  data-mention-idx={index}
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
            <div className="absolute bottom-[6.25rem] left-3 right-3 z-30 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
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
            <div className="relative box-border min-h-[3rem]">
              <div
                aria-hidden
                className="pointer-events-none absolute left-0 right-0 top-0 bottom-7 box-border overflow-hidden whitespace-pre-wrap break-words px-1 py-1.5 pr-3 font-sans text-sm leading-6 text-zinc-900"
              >
                {highlightedComposer.map((segment, index) =>
                  segment.highlight ? (
                    <span
                      key={index}
                      className="font-medium text-blue-800 underline decoration-blue-300/80 decoration-1 underline-offset-2"
                    >
                      {segment.text}
                    </span>
                  ) : (
                    <span key={index}>{segment.text}</span>
                  ),
                )}
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
                      mentionAtAnchorRef.current = -1;
                      mentionMenuKeyRef.current = "";
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
                      commandAnchorRef.current = -1;
                      commandMenuKeyRef.current = "";
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
                className="relative z-10 box-border max-h-28 min-h-[3rem] w-full resize-none bg-transparent px-1 py-1.5 pb-7 pr-3 font-sans text-sm leading-6 text-transparent caret-zinc-900 outline-none placeholder:text-zinc-400 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300"
              />
            </div>
            {composerMentionChips.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1 border-t border-zinc-100 pt-1.5">
                {composerMentionChips.map((path) => (
                  <span
                    key={path}
                    className="max-w-full truncate rounded-md border border-blue-200/80 bg-blue-50/90 px-1.5 py-0.5 text-[10px] font-medium text-blue-900"
                    title={path}
                  >
                    {path.split("/").pop() || path}
                  </span>
                ))}
              </div>
            )}
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
      {commentStatus && (
        <div className="absolute bottom-2 left-[344px] z-40 max-w-md rounded-full border border-red-200 bg-red-50/95 px-3 py-1.5 text-[11px] text-red-700 shadow-sm">
          {commentStatus}
        </div>
      )}
    </div>
  );
}
