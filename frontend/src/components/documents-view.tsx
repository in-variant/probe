"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  File,
  FileCode,
  FileText,
  Film,
  Folder,
  FolderPlus,
  GitBranch,
  Image,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreVertical,
  Music,
  Plus,
  Presentation,
  Search,
  Sheet,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import mermaid from "mermaid";
import { cn, formatBytes, formatDate, formatRelativeDate, getFileIcon, getFileIconTone } from "@/lib/utils";
import {
  listDocuments,
  createFolder,
  deleteFolder,
  uploadFilesWithProgress,
  uploadAndExtractZip,
  deleteFile,
  bulkDeleteFiles,
  getDownloadUrl,
  getFileTextContent,
  updateFile,
  getWorkspace,
  type FolderItem,
  type FileItem,
} from "@/lib/api";
import { DriveFileBrowser } from "@/components/google-drive-picker";

// ── Icon map ─────────────────────────────────────────────────────

const FILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  Image,
  Film,
  Music,
  Archive,
  FileCode,
  Sheet,
  Presentation,
  File,
};

function FileIconComponent({ extension, className }: { extension: string; className?: string }) {
  const iconName = getFileIcon(extension);
  const IconComp = FILE_ICONS[iconName] || File;
  return <IconComp className={className} />;
}

// ── Status config ────────────────────────────────────────────────

const FILE_STATUS_CONFIG: Record<string, { label: string; style: string }> = {
  uploaded: { label: "Uploaded", style: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" },
  "in-review": { label: "In Review", style: "bg-sky-50 text-sky-700 ring-1 ring-sky-100" },
  approved: { label: "Approved", style: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" },
  pending: { label: "Pending", style: "bg-amber-50 text-amber-700 ring-1 ring-amber-100" },
  rejected: { label: "Rejected", style: "bg-rose-50 text-rose-700 ring-1 ring-rose-100" },
};

function FileStatusBadge({ status }: { status: string }) {
  const config = FILE_STATUS_CONFIG[status] || FILE_STATUS_CONFIG.uploaded;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", config.style)}>
      {config.label}
    </span>
  );
}

// ── Filter select (vault-style pill) ─────────────────────────────

function FilterSelect({
  label,
  icon,
  value,
  onChange,
  options,
}: {
  label: string;
  icon?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition hover:bg-zinc-50 active:bg-zinc-100">
      {icon ? <span className="text-zinc-500">{icon}</span> : null}
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-xs text-zinc-600 outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

// ── View toggle (vault-style pill group) ─────────────────────────

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: "list" | "grid";
  onChange: (mode: "list" | "grid") => void;
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="inline-flex overflow-hidden rounded-full border border-zinc-200 bg-white"
    >
      <button
        type="button"
        aria-pressed={viewMode === "list"}
        onClick={() => onChange("list")}
        className={cn(
          "grid h-8 w-9 cursor-pointer place-items-center transition",
          viewMode === "list" ? "bg-blue-50 text-blue-700" : "text-zinc-500 hover:bg-zinc-50",
        )}
        title="List view"
      >
        <ListIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-pressed={viewMode === "grid"}
        onClick={() => onChange("grid")}
        className={cn(
          "grid h-8 w-9 cursor-pointer place-items-center border-l border-zinc-200 transition",
          viewMode === "grid" ? "bg-blue-50 text-blue-700" : "text-zinc-500 hover:bg-zinc-50",
        )}
        title="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Bulk actions bar ─────────────────────────────────────────────

function BulkActionsBar({
  count,
  onDownload,
  onDelete,
  onClear,
}: {
  count: number;
  onDownload: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="animate-slide-down flex items-center justify-between rounded-xl bg-zinc-900 p-3 text-white">
      <span className="text-sm font-medium">{count} selected</span>
      <div className="flex items-center gap-2">
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-zinc-800 transition-colors"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </button>
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-700 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
        <button onClick={onClear} className="rounded-lg p-1.5 hover:bg-zinc-800 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── File detail drawer (vault-style) ─────────────────────────────

type DrawerTab = "details" | "activity" | "versions";

export function DetailDrawer({
  file,
  workspaceId,
  onClose,
  onRefresh,
  onPreview,
}: {
  file: FileItem;
  workspaceId: string;
  onClose: () => void;
  onRefresh: () => void;
  onPreview?: (file: FileItem) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>("details");
  const [status, setStatus] = useState(file.status);
  const [saving, setSaving] = useState(false);
  const tone = getFileIconTone(file.extension);

  const TABS: { key: DrawerTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "details", label: "Details", icon: Eye },
    { key: "activity", label: "Activity", icon: Clock },
    { key: "versions", label: "Versions", icon: GitBranch },
  ];

  async function handleSaveStatus() {
    setSaving(true);
    try {
      await updateFile(workspaceId, file.path, { status });
      toast.success("File status updated");
      onRefresh();
    } catch {
      toast.error("Failed to update file status");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    try {
      const { url } = await getDownloadUrl(workspaceId, file.path);
      window.open(url, "_blank");
    } catch {
      toast.error("Failed to get download link");
    }
  }

  async function handleDelete() {
    try {
      await deleteFile(workspaceId, file.path);
      toast.success("File deleted");
      onRefresh();
      onClose();
    } catch {
      toast.error("Failed to delete file");
    }
  }

  return (
    <>
      <button
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-zinc-900/25 transition-opacity",
          "pointer-events-auto opacity-100",
        )}
      />
      <aside className="fixed inset-0 z-50 h-dvh w-full animate-slide-in-right bg-white shadow-xl sm:inset-auto sm:right-0 sm:top-0 sm:max-w-[520px] sm:border-l sm:border-zinc-200">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">File details</p>
              <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg ring-1", tone)}>
                <FileIconComponent extension={file.extension} className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold tracking-[-0.02em] text-zinc-900">{file.name}</h3>
                <p className="text-xs text-zinc-500">{file.path}</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-zinc-200 px-4 sm:px-5">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  tab === key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-zinc-500 hover:text-zinc-700"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 text-sm sm:px-5">
            {tab === "details" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-zinc-500">Type</p>
                    <p className="text-zinc-800">{file.content_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Size</p>
                    <p className="text-zinc-800">{formatBytes(file.size)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-zinc-500">Extension</p>
                    <p className="text-zinc-800">.{file.extension || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Created</p>
                    <p className="text-zinc-800">{formatDate(file.created_at)}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Last Modified</p>
                  <p className="text-zinc-800">{formatDate(file.updated_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Status</p>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    {Object.entries(FILE_STATUS_CONFIG).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            {tab === "activity" && (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 h-2 w-2 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-sm text-zinc-800">File uploaded</p>
                    <p className="text-xs text-zinc-500">{formatDate(file.created_at)}</p>
                  </div>
                </div>
                {file.updated_at !== file.created_at && (
                  <div className="flex items-start gap-3">
                    <div className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                    <div>
                      <p className="text-sm text-zinc-800">File modified</p>
                      <p className="text-xs text-zinc-500">{formatDate(file.updated_at)}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {tab === "versions" && (
              <div className="py-8 text-center">
                <GitBranch className="mx-auto h-8 w-8 text-zinc-300" />
                <p className="mt-2 text-sm text-zinc-500">Version history coming soon</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => onPreview?.(file)}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                Preview
              </button>
              <button
                onClick={handleDownload}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 transition-colors"
              >
                Download
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg border border-rose-300 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50 transition-colors"
              >
                Delete
              </button>
            </div>
            {tab === "details" && status !== file.status && (
              <button
                onClick={handleSaveStatus}
                disabled={saving}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const id = useId();

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "strict",
    });
    mermaid
      .render(`mermaid-${id.replace(/[:]/g, "-")}`, chart)
      .then(({ svg: renderedSvg }) => {
        if (!cancelled) setSvg(renderedSvg);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to render Mermaid diagram");
      });
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        Mermaid render error: {error}
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Rendering diagram...
      </div>
    );
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-zinc-200 bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

type PreviewKind = "image" | "pdf" | "office" | "markdown" | "text" | "unsupported";

function FilePreviewModal({
  file,
  workspaceId,
  onClose,
}: {
  file: FileItem;
  workspaceId: string;
  onClose: () => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [textContent, setTextContent] = useState<string | null>(null);

  const extension = (file.extension || "").toLowerCase();
  const previewKind: PreviewKind = useMemo(() => {
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(extension)) return "image";
    if (extension === "pdf") return "pdf";
    if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(extension)) return "office";
    if (extension === "md" || extension === "markdown") return "markdown";
    if (["txt", "text", "log", "csv", "json", "yaml", "yml", "xml"].includes(extension)) return "text";
    return "unsupported";
  }, [extension]);

  useEffect(() => {
    let cancelled = false;
    getDownloadUrl(workspaceId, file.path)
      .then(({ url }) => {
        if (cancelled) return;
        setPreviewUrl(url);
        if (previewKind === "markdown" || previewKind === "text") {
          getFileTextContent(workspaceId, file.path)
            .then((text) => {
              if (!cancelled) {
                setTextContent(text);
                setViewerLoading(false);
              }
            })
            .catch((err) => {
              if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load text preview");
            });
        } else if (previewKind === "unsupported") {
          setViewerLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load preview");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, file.path, previewKind]);

  const officeViewerUrl = previewUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(previewUrl)}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-zinc-900">{file.name}</h3>
            <p className="truncate text-xs text-zinc-500">{file.path}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="relative flex-1 bg-zinc-50">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <AlertCircle className="h-8 w-8 text-rose-500" />
              <p className="text-sm text-zinc-700">Unable to preview this file.</p>
              <p className="text-xs text-zinc-500">{error}</p>
            </div>
          ) : previewKind === "image" && previewUrl ? (
            <div className="flex h-full items-center justify-center p-4">
              <img
                src={previewUrl}
                alt={file.name}
                onLoad={() => setViewerLoading(false)}
                onError={() => {
                  setViewerLoading(false);
                  setError("Failed to render image preview");
                }}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : previewKind === "pdf" && previewUrl ? (
            <iframe
              title={`Preview ${file.name}`}
              src={previewUrl}
              onLoad={() => setViewerLoading(false)}
              className="h-full w-full border-0 bg-white"
            />
          ) : previewKind === "office" && officeViewerUrl ? (
            <iframe
              title={`Preview ${file.name}`}
              src={officeViewerUrl}
              onLoad={() => setViewerLoading(false)}
              className="h-full w-full border-0 bg-white"
            />
          ) : previewKind === "markdown" && textContent !== null ? (
            <div className="h-full overflow-y-auto bg-white p-6">
              <article className="prose prose-zinc max-w-none prose-pre:bg-zinc-100 prose-pre:text-zinc-800 prose-code:text-zinc-800">
                <ReactMarkdown
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || "");
                      const language = match?.[1] ?? "";
                      const code = String(children).replace(/\n$/, "");
                      if (language.toLowerCase() === "mermaid") {
                        return <MermaidBlock chart={code} />;
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                    pre({ children }) {
                      return <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-3 text-zinc-800">{children}</pre>;
                    },
                  }}
                >
                  {textContent}
                </ReactMarkdown>
              </article>
            </div>
          ) : previewKind === "text" && textContent !== null ? (
            <pre className="h-full overflow-auto bg-white p-6 text-sm leading-6 text-zinc-800">{textContent}</pre>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <AlertCircle className="h-8 w-8 text-zinc-400" />
              <p className="text-sm text-zinc-700">Preview is not available for this file type yet.</p>
            </div>
          )}
          {!loading && !error && viewerLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/75">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading preview...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Add File modal (tabbed: Local Upload / Google Drive) ─────────

type AddFileTab = "local" | "drive" | "zip";
type UploadState = "selecting" | "uploading" | "done" | "error";

function AddFileModal({
  workspaceId,
  currentPath,
  initialFiles = [],
  initialTab = "local",
  onClose,
  onUploaded,
}: {
  workspaceId: string;
  currentPath: string;
  initialFiles?: File[];
  initialTab?: AddFileTab;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [tab, setTab] = useState<AddFileTab>(initialTab);
  const [stagedFiles, setStagedFiles] = useState<File[]>(initialFiles);
  const [uploadState, setUploadState] = useState<UploadState>("selecting");
  const [progress, setProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const dragCounterRef = useRef(0);

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    if (arr.length === 0) return;
    setStagedFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}-${f.size}-${f.lastModified}`));
      const deduped = arr.filter((f) => !existing.has(`${f.name}-${f.size}-${f.lastModified}`));
      return [...prev, ...deduped];
    });
  }

  function removeFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUpload() {
    if (stagedFiles.length === 0) return;
    setUploadState("uploading");
    setProgress(0);
    setErrorMsg("");

    const { promise, abort } = uploadFilesWithProgress(
      workspaceId,
      stagedFiles,
      currentPath,
      "uploaded",
      (loaded, total) => {
        setProgress(Math.round((loaded / total) * 100));
      }
    );
    abortRef.current = abort;

    try {
      await promise;
      setProgress(100);
      setUploadState("done");
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") return;
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setUploadState("error");
    }
  }

  function handleFinish() {
    onUploaded();
    onClose();
  }

  function handleCancel() {
    if (uploadState === "uploading") {
      abortRef.current?.();
    }
    onClose();
  }

  const totalSize = stagedFiles.reduce((sum, f) => sum + f.size, 0);

  const TAB_ITEMS: { key: AddFileTab; label: string; icon: React.ReactNode }[] = [
    {
      key: "local",
      label: "Local Upload",
      icon: <Upload className="h-3.5 w-3.5" />,
    },
    {
      key: "drive",
      label: "Google Drive",
      icon: (
        <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
          <path d="m6.6 66.85 3.85 6.65c.8 1.45 1.95 2.65 3.3 3.55l13.75-23.8H.25c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
          <path d="m43.65 25-13.75-23.8c-1.35.9-2.5 2.1-3.3 3.55L1.2 53.25H28.7z" fill="#00AC47"/>
          <path d="m73.55 76.8c1.35-.9 2.5-2.1 3.3-3.55l1.6-2.75 7.65-13.25c.8-1.45 1.2-3.1 1.2-4.5H59.8l5.85 13.25z" fill="#EA4335"/>
          <path d="m43.65 25 13.75-23.8c-1.35-.9-2.9-1.2-4.5-1.2H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
          <path d="M59.8 53.25H27.5l-13.75 23.8c1.35.9 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC"/>
          <path d="M73.4 26.5 60.65 4.75c-.8-1.45-1.95-2.65-3.3-3.55L43.6 25l16.2 28.25H87.3c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
        </svg>
      ),
    },
    {
      key: "zip",
      label: "Zip Upload",
      icon: <Archive className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm animate-fade-in sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl border border-zinc-200 bg-white shadow-xl animate-slide-down sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-4 sm:px-6">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-zinc-900">Add Files</h2>
          <button
            onClick={handleCancel}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        {uploadState === "selecting" && (
          <div className="flex border-b border-zinc-200 px-4 sm:px-6">
            {TAB_ITEMS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  tab === key
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-zinc-500 hover:text-zinc-700"
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="px-4 py-5 sm:px-6">
          {uploadState === "selecting" && tab === "local" && (
            <>
              <div
                onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragOver(false); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dragCounterRef.current = 0; setIsDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => filePickerRef.current?.click()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 transition-colors",
                  isDragOver
                    ? "border-blue-400 bg-blue-50"
                    : "border-zinc-200 bg-zinc-50/50 hover:border-blue-300 hover:bg-blue-50/50"
                )}
              >
                <UploadCloud className={cn("h-10 w-10 transition-colors", isDragOver ? "text-blue-500" : "text-zinc-300")} />
                <p className="mt-3 text-sm font-medium text-zinc-700">Drag & drop files here</p>
                <p className="mt-1 text-xs text-zinc-400">or <span className="font-medium text-blue-600">browse from your system</span></p>
                <input ref={filePickerRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
              </div>

              {stagedFiles.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                      {stagedFiles.length} file{stagedFiles.length !== 1 ? "s" : ""} selected
                      <span className="ml-2 normal-case tracking-normal text-zinc-400">({formatBytes(totalSize)})</span>
                    </p>
                    <button onClick={() => setStagedFiles([])} className="text-xs font-medium text-zinc-400 hover:text-zinc-600 transition-colors">Clear all</button>
                  </div>
                  <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                    {stagedFiles.map((file, i) => {
                      const ext = file.name.split(".").pop() || "";
                      const tone = getFileIconTone(ext);
                      return (
                        <div key={`${file.name}-${file.size}-${i}`} className="group flex items-center gap-3 rounded-lg bg-zinc-50 px-3 py-2">
                          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1", tone)}>
                            <FileIconComponent extension={ext} className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">{file.name}</span>
                          <span className="shrink-0 text-xs text-zinc-400">{formatBytes(file.size)}</span>
                          <button onClick={() => removeFile(i)} className="shrink-0 rounded p-0.5 text-zinc-300 opacity-0 transition-all hover:bg-zinc-200 hover:text-zinc-600 group-hover:opacity-100">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {uploadState === "selecting" && tab === "drive" && (
            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <DriveFileBrowser
                workspaceId={workspaceId}
                currentPath={currentPath}
                onImportComplete={() => {
                  onUploaded();
                  onClose();
                }}
              />
            </div>
          )}

          {uploadState === "selecting" && tab === "zip" && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-200 bg-zinc-50/50 py-8 transition-colors hover:border-blue-300 hover:bg-blue-50/50">
                <Archive className="h-10 w-10 text-zinc-300" />
                <p className="mt-3 text-sm font-medium text-zinc-700">Upload a zip archive</p>
                <p className="mt-1 text-xs text-zinc-400">Contents will extract into a folder with the zip name</p>
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setZipFile(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {zipFile && (
                <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                  Selected: <span className="font-medium">{zipFile.name}</span> ({formatBytes(zipFile.size)})
                </div>
              )}
            </div>
          )}

          {uploadState === "uploading" && (
            <div className="py-6">
              <div className="flex flex-col items-center">
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin" />
                <p className="mt-4 text-sm font-medium text-zinc-700">
                  {tab === "zip" ? "Uploading and extracting archive…" : `Uploading ${stagedFiles.length} file${stagedFiles.length !== 1 ? "s" : ""}…`}
                </p>
                {tab !== "zip" ? <p className="mt-1 text-xs text-zinc-400">{formatBytes(totalSize)}</p> : null}
              </div>
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                  <span>Progress</span>
                  <span className="font-medium tabular-nums">{progress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>
          )}

          {uploadState === "done" && (
            <div className="flex flex-col items-center py-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              {tab === "zip" ? (
                <p className="mt-4 text-sm font-medium text-zinc-800">Zip uploaded and extracted successfully</p>
              ) : (
                <>
                  <p className="mt-4 text-sm font-medium text-zinc-800">{stagedFiles.length} file{stagedFiles.length !== 1 ? "s" : ""} uploaded successfully</p>
                  <p className="mt-1 text-xs text-zinc-400">{formatBytes(totalSize)} total</p>
                </>
              )}
            </div>
          )}

          {uploadState === "error" && (
            <div className="flex flex-col items-center py-8">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50">
                <AlertCircle className="h-7 w-7 text-rose-500" />
              </div>
              <p className="mt-4 text-sm font-medium text-zinc-800">Upload failed</p>
              <p className="mt-1 text-xs text-zinc-400">{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer (only for local upload tab) */}
        {(uploadState !== "selecting" || tab === "local" || tab === "zip") && (
          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-4 py-4 sm:px-6">
            {uploadState === "selecting" && (
              <>
                <button onClick={handleCancel} className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">Cancel</button>
                {tab === "local" ? (
                  <button
                    onClick={handleUpload}
                    disabled={stagedFiles.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Upload className="h-4 w-4" />
                    Upload {stagedFiles.length > 0 ? `(${stagedFiles.length})` : ""}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      if (!zipFile) return;
                      setUploadState("uploading");
                      setErrorMsg("");
                      try {
                        await uploadAndExtractZip(workspaceId, zipFile, currentPath);
                        setUploadState("done");
                      } catch (err) {
                        setErrorMsg(err instanceof Error ? err.message : "Zip import failed");
                        setUploadState("error");
                      }
                    }}
                    disabled={!zipFile}
                    className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Archive className="h-4 w-4" />
                    Upload & Extract
                  </button>
                )}
              </>
            )}
            {uploadState === "uploading" && (
              <button onClick={handleCancel} className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">Cancel</button>
            )}
            {uploadState === "done" && (
              <button onClick={handleFinish} className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">Done</button>
            )}
            {uploadState === "error" && (
              <>
                <button onClick={handleCancel} className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 transition-colors">Close</button>
                <button onClick={() => { setUploadState("selecting"); setProgress(0); setErrorMsg(""); }} className="rounded-full bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700">Try Again</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create folder modal ──────────────────────────────────────────

function CreateFolderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await onCreated(name.trim());
      onClose();
    } catch {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-sm animate-fade-in sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl border border-zinc-200 bg-white p-6 shadow-xl animate-slide-down sm:rounded-2xl">
        <h2 className="text-lg font-semibold tracking-[-0.02em] text-zinc-900">New Folder</h2>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Folder Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Documents"
              className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100">Cancel</button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Google Drive Import Banner ───────────────────────────────────

function GDriveImportBanner({
  workspaceId,
  onImportComplete,
}: {
  workspaceId: string;
  onImportComplete: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [imported, setImported] = useState(0);
  const [total, setTotal] = useState(0);
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("gdrive-import-banner-dismissed-keys");
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((x) => typeof x === "string"));
    } catch {
      return new Set();
    }
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const ws = await getWorkspace(workspaceId);
        if (!active) return;
        setStatus(ws.gdrive_import_status ?? null);
        setImported(ws.gdrive_imported_count ?? 0);
        setTotal(ws.gdrive_total_count ?? 0);

        if (ws.gdrive_import_status === "completed" || ws.gdrive_import_status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          onImportComplete();
        }
      } catch {
        // ignore
      }
    }

    check();
    pollRef.current = setInterval(check, 3000);

    return () => {
      active = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [workspaceId, onImportComplete]);

  const dismissalKey =
    status && (status === "completed" || status === "failed")
      ? `gdrive-import-banner-dismissed:${workspaceId}:${status}:${imported}:${total}`
      : null;
  const dismissed = dismissalKey ? dismissedKeys.has(dismissalKey) : false;

  if (!status || dismissed) return null;

  if (status === "completed") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-800">
            Google Drive import complete
          </p>
          <p className="text-xs text-emerald-600">
            {imported} file{imported !== 1 ? "s" : ""} imported successfully
          </p>
        </div>
        <button
          onClick={() => {
            if (dismissalKey) {
              setDismissedKeys((prev) => {
                const next = new Set(prev);
                next.add(dismissalKey);
                try {
                  localStorage.setItem("gdrive-import-banner-dismissed-keys", JSON.stringify(Array.from(next)));
                } catch {
                  // ignore storage errors
                }
                return next;
              });
            }
          }}
          className="shrink-0 rounded-lg p-1 text-emerald-400 hover:bg-emerald-100 hover:text-emerald-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-rose-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rose-800">
            Google Drive import failed
          </p>
          <p className="text-xs text-rose-600">
            Some files could not be imported. {imported > 0 ? `${imported} file${imported !== 1 ? "s" : ""} were imported before the error.` : ""}
          </p>
        </div>
        <button
          onClick={() => {
            if (dismissalKey) {
              setDismissedKeys((prev) => {
                const next = new Set(prev);
                next.add(dismissalKey);
                try {
                  localStorage.setItem("gdrive-import-banner-dismissed-keys", JSON.stringify(Array.from(next)));
                } catch {
                  // ignore storage errors
                }
                return next;
              });
            }
          }}
          className="shrink-0 rounded-lg p-1 text-rose-400 hover:bg-rose-100 hover:text-rose-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const pct = total > 0 ? Math.round((imported / total) * 100) : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50/70">
      <div className="flex items-center gap-3 px-4 py-3">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-blue-800">
            Importing files from Google Drive…
          </p>
          <p className="text-xs text-blue-600">
            {total > 0
              ? `${imported} of ${total} file${total !== 1 ? "s" : ""} imported`
              : "Scanning folder…"}
          </p>
        </div>
        {total > 0 && (
          <span className="shrink-0 text-xs font-medium tabular-nums text-blue-700">
            {pct}%
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="h-1 w-full bg-blue-100">
          <div
            className="h-full bg-blue-500 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Documents View ──────────────────────────────────────────

export function DocumentsView({ workspaceId }: { workspaceId: string }) {
  const [currentPath, setCurrentPath] = useState("/");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modifiedFilter, setModifiedFilter] = useState("ALL");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [drawerFile, setDrawerFile] = useState<FileItem | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [gdriveImporting, setGdriveImporting] = useState<boolean | null>(null);
  const dragCounter = useRef(0);

  const fetchDocuments = useCallback(async () => {
    try {
      setSyncing(true);
      const data = await listDocuments(workspaceId, currentPath);
      setFolders(data.folders);
      setFiles(data.files);
    } catch {
      toast.error("Failed to load documents");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }, [workspaceId, currentPath]);

  useEffect(() => {
    setLoading(true);
    setSelectedFiles(new Set());
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    let cancelled = false;
    getWorkspace(workspaceId).then((ws) => {
      if (!cancelled) {
        setGdriveImporting(ws.gdrive_import_status === "importing" || ws.gdrive_import_status === "completed" || ws.gdrive_import_status === "failed");
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]);

  useEffect(() => {
    if (!folderMenuOpen) return;
    function handleClick() { setFolderMenuOpen(null); }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [folderMenuOpen]);

  function navigateTo(path: string) {
    setCurrentPath(path || "/");
    setSearch("");
    setStatusFilter("ALL");
    setModifiedFilter("ALL");
  }

  async function handleCreateFolder(name: string) {
    try {
      await createFolder(workspaceId, name, currentPath);
      toast.success("Folder created");
      fetchDocuments();
    } catch {
      toast.error("Failed to create folder");
      throw new Error("create-folder-failed");
    }
  }

  async function handleDeleteFolder(path: string) {
    try {
      await deleteFolder(workspaceId, path);
      toast.success("Folder deleted");
      fetchDocuments();
    } catch {
      toast.error("Failed to delete folder");
    }
  }

  function openUploadModal(initialFiles?: FileList | File[]) {
    if (initialFiles) {
      setDroppedFiles(Array.from(initialFiles));
    } else {
      setDroppedFiles([]);
    }
    setShowUploadModal(true);
  }

  async function handleBulkDelete() {
    const paths = Array.from(selectedFiles);
    try {
      await bulkDeleteFiles(workspaceId, paths);
      toast.success(`${paths.length} file${paths.length !== 1 ? "s" : ""} deleted`);
      setSelectedFiles(new Set());
      fetchDocuments();
    } catch {
      toast.error("Failed to delete selected files");
    }
  }

  function toggleFileSelection(path: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedFiles.size === filteredFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredFiles.map((f) => f.path)));
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files.length) openUploadModal(e.dataTransfer.files);
  }

  const pathSegments = currentPath === "/" ? [] : currentPath.split("/").filter(Boolean);
  const currentLocationName = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : workspaceId;

  const availableStatuses = useMemo(() => {
    const statuses = new Set(files.map((f) => f.status));
    return ["ALL", ...Array.from(statuses).sort()];
  }, [files]);

  const filteredFolders = useMemo(() => {
    if (!search) return folders;
    const q = search.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const filteredFiles = useMemo(() => {
    const now = Date.now();
    return files
      .filter((f) => !search || f.name.toLowerCase().includes(search.toLowerCase()))
      .filter((f) => statusFilter === "ALL" || f.status === statusFilter)
      .filter((f) => {
        if (modifiedFilter === "ALL") return true;
        if (!f.updated_at) return true;
        const ageMs = now - new Date(f.updated_at).getTime();
        if (modifiedFilter === "7D") return ageMs <= 7 * 24 * 60 * 60 * 1000;
        if (modifiedFilter === "30D") return ageMs <= 30 * 24 * 60 * 60 * 1000;
        return true;
      })
      .sort((a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime());
  }, [files, search, statusFilter, modifiedFilter]);

  const isEmpty = filteredFolders.length === 0 && filteredFiles.length === 0 && !loading;

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
        <div className="border-b border-zinc-200/70 px-4 pb-3 pt-5 md:px-6 md:pt-6">
          <div className="h-8 w-64 animate-pulse rounded-xl bg-zinc-100" />
          <div className="mt-4 h-8 w-96 animate-pulse rounded-xl bg-zinc-100" />
        </div>
        <div className="px-4 pb-10 pt-5 md:px-6">
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-zinc-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative h-full overflow-hidden rounded-2xl border border-zinc-200/80 bg-white"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex h-full flex-col">
        {/* Header: navigable breadcrumb */}
        <header className="border-b border-zinc-200/70 bg-white/70 px-4 pb-3 pt-5 md:px-6 md:pt-6">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 overflow-x-auto text-lg font-medium text-zinc-900 sm:text-2xl">
            <button
              type="button"
              onClick={() => navigateTo("/")}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-2 py-1 transition",
                "hover:bg-zinc-100 active:bg-zinc-200",
                currentPath === "/" ? "text-zinc-900" : "text-zinc-700",
              )}
              title={`Open ${workspaceId}`}
            >
              <Folder className="h-6 w-6 text-blue-600" />
              <span className="truncate">{workspaceId}</span>
              {currentPath === "/" ? <ChevronDown className="h-5 w-5 text-zinc-500" /> : null}
            </button>
            {pathSegments.map((seg, i) => {
              const isLast = i === pathSegments.length - 1;
              const segPath = pathSegments.slice(0, i + 1).join("/");
              return (
                <span key={segPath} className="flex items-center gap-1">
                  <ChevronRight className="h-5 w-5 text-zinc-400" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => navigateTo(segPath)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-lg px-2 py-1 transition",
                      "hover:bg-zinc-100 active:bg-zinc-200",
                      isLast ? "text-zinc-900" : "text-zinc-700",
                    )}
                    title={`Open ${seg}`}
                  >
                    <span className="max-w-[24ch] truncate">{seg}</span>
                    {isLast ? <ChevronDown className="h-5 w-5 text-zinc-500" /> : null}
                  </button>
                </span>
              );
            })}
          </nav>

          {/* Filter / utility row */}
          <div className="mt-4 space-y-3 md:space-y-0 md:flex md:flex-wrap md:items-center md:justify-between md:gap-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={availableStatuses.map((s) => ({
                  value: s,
                  label: s === "ALL" ? "All" : (FILE_STATUS_CONFIG[s]?.label ?? s),
                }))}
              />
              <FilterSelect
                label="Modified"
                value={modifiedFilter}
                onChange={setModifiedFilter}
                options={[
                  { value: "ALL", label: "Any time" },
                  { value: "7D", label: "Last 7 days" },
                  { value: "30D", label: "Last 30 days" },
                ]}
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 md:flex-initial">
                <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full min-w-0 bg-transparent text-sm text-zinc-700 outline-none placeholder:text-zinc-400 md:w-44"
                />
              </div>

              <ViewToggle viewMode={viewMode} onChange={setViewMode} />

              <button
                type="button"
                onClick={() => setShowCreateFolder(true)}
                className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition cursor-pointer hover:bg-zinc-50 active:bg-zinc-100 sm:inline-flex"
                title="Create a new folder"
              >
                <FolderPlus className="h-4 w-4" />
                New folder
              </button>
              <button
                type="button"
                onClick={() => setShowCreateFolder(true)}
                className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-700 transition cursor-pointer hover:bg-zinc-50 active:bg-zinc-100 sm:hidden"
                title="Create a new folder"
              >
                <FolderPlus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => openUploadModal()}
                className="inline-flex shrink-0 items-center gap-2 rounded-full bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition cursor-pointer hover:bg-blue-700 active:bg-blue-800"
                title="Add files"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Add File</span>
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-zinc-400" aria-live="polite">
            {syncing ? "Syncing changes..." : "All changes synced"}
          </p>
        </header>

        {/* Google Drive import banner */}
        {gdriveImporting && (
          <div className="px-4 pt-3 md:px-6">
            <GDriveImportBanner
              workspaceId={workspaceId}
              onImportComplete={fetchDocuments}
            />
          </div>
        )}

        {/* Bulk actions */}
        {selectedFiles.size > 0 && (
          <div className="px-4 pt-3 md:px-6">
            <BulkActionsBar
              count={selectedFiles.size}
              onDownload={() => {}}
              onDelete={handleBulkDelete}
              onClear={() => setSelectedFiles(new Set())}
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 pb-10 pt-5 md:px-6">
          {isEmpty && !search && statusFilter === "ALL" && modifiedFilter === "ALL" ? (
            <div className="flex flex-col items-center justify-center py-20">
              <UploadCloud className="h-12 w-12 text-zinc-300 animate-pulse-gentle" />
              <h3 className="mt-4 text-base font-semibold tracking-[-0.02em] text-zinc-900">This folder is empty</h3>
              <p className="mt-1 text-sm text-zinc-500">
                Drag and drop files here or{" "}
                <button onClick={() => openUploadModal()} className="font-medium text-blue-600 hover:text-blue-700">upload files</button>
              </p>
            </div>
          ) : isEmpty ? (
            <div className="py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-zinc-300" />
              <p className="mt-2 text-sm text-zinc-500">No results found</p>
            </div>
          ) : (
            <>
              {/* Folders */}
              {filteredFolders.length > 0 && (
                <section aria-labelledby="folders-heading" className="mb-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 id="folders-heading" className="text-sm font-semibold text-zinc-700">Folders</h3>
                    <span className="text-xs text-zinc-500">{filteredFolders.length} items</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {filteredFolders.map((folder) => (
                      <div
                        key={folder.path}
                        onClick={() => {
                          if (folderMenuOpen === folder.path) return;
                          navigateTo(folder.path);
                        }}
                        className={cn(
                          "group flex w-full items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 text-left transition",
                          "cursor-pointer hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-sm",
                        )}
                        title={`Open ${folder.name}`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                            <Folder className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-zinc-900">{folder.name}</span>
                            <span className="block text-xs text-zinc-500">
                              {folder.file_count ?? 0} file{(folder.file_count ?? 0) !== 1 ? "s" : ""} · {formatRelativeDate(folder.updated_at)}
                            </span>
                          </span>
                        </span>
                        <div className="relative">
                          <button
                            type="button"
                            aria-label={`More actions for ${folder.name}`}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolderMenuOpen(folderMenuOpen === folder.path ? null : folder.path);
                            }}
                            className="grid h-8 w-8 cursor-pointer place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 sm:invisible sm:group-hover:visible"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {folderMenuOpen === folder.path && (
                            <div
                              className="animate-slide-down absolute right-0 top-8 z-10 w-36 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setFolderMenuOpen(null);
                                  handleDeleteFolder(folder.path);
                                }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Files */}
              {filteredFiles.length > 0 && (
                <section aria-labelledby="files-heading">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 id="files-heading" className="text-sm font-semibold text-zinc-700">Files</h3>
                    <span className="text-xs text-zinc-500">{filteredFiles.length} items</span>
                  </div>
                  <div className="max-h-[52dvh] overflow-y-auto pr-1">
                    {viewMode === "list" ? (
                      <>
                        {/* Desktop table */}
                        <div className="hidden overflow-hidden rounded-xl border border-zinc-200 md:block">
                          <table className="w-full text-sm">
                            <thead className="bg-zinc-50 text-left text-[11px] uppercase tracking-[0.08em] text-zinc-500">
                              <tr>
                                <th className="w-10 px-4 py-2.5">
                                  <input
                                    type="checkbox"
                                    checked={selectedFiles.size === filteredFiles.length && filteredFiles.length > 0}
                                    onChange={toggleSelectAll}
                                    className="h-4 w-4 rounded border-zinc-300 accent-blue-600"
                                  />
                                </th>
                                <th className="px-4 py-2.5 font-medium">Name</th>
                                <th className="px-4 py-2.5 font-medium">Status</th>
                                <th className="px-4 py-2.5 font-medium">Updated</th>
                                <th className="px-4 py-2.5 font-medium">Size</th>
                                <th className="w-10 px-2 py-2.5" aria-label="Actions" />
                              </tr>
                            </thead>
                            <tbody>
                              {filteredFiles.map((file) => {
                                const tone = getFileIconTone(file.extension);
                                return (
                                  <tr
                                    key={file.path}
                                    onClick={() => setDrawerFile(file)}
                                    className={cn(
                                      "group cursor-pointer border-t border-zinc-100 transition",
                                      selectedFiles.has(file.path)
                                        ? "bg-blue-50/60"
                                        : "hover:bg-blue-50/40",
                                    )}
                                  >
                                    <td className="px-4 py-2.5">
                                      <input
                                        type="checkbox"
                                        checked={selectedFiles.has(file.path)}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={() => toggleFileSelection(file.path)}
                                        className="h-4 w-4 rounded border-zinc-300 accent-blue-600"
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <span className="flex min-w-0 items-center gap-3">
                                        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1", tone)}>
                                          <FileIconComponent extension={file.extension} className="h-4 w-4" />
                                        </span>
                                        <span className="min-w-0">
                                          <span className="block truncate font-medium text-zinc-900">{file.name}</span>
                                          <span className="block text-[11px] uppercase tracking-[0.06em] text-zinc-400">{file.extension}</span>
                                        </span>
                                      </span>
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <FileStatusBadge status={file.status} />
                                    </td>
                                    <td className="px-4 py-2.5 text-zinc-600">{formatRelativeDate(file.updated_at)}</td>
                                    <td className="px-4 py-2.5 text-zinc-600">{formatBytes(file.size)}</td>
                                    <td className="px-2 py-2.5 text-right">
                                      <button
                                        type="button"
                                        aria-label={`More actions for ${file.name}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDrawerFile(file);
                                        }}
                                        className="invisible grid h-8 w-8 cursor-pointer place-items-center rounded-full text-zinc-500 transition hover:bg-zinc-100 group-hover:visible"
                                      >
                                        <MoreVertical className="h-4 w-4" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile card list */}
                        <div className="space-y-2 md:hidden">
                          <div className="flex items-center gap-2 px-1 pb-1">
                            <input
                              type="checkbox"
                              checked={selectedFiles.size === filteredFiles.length && filteredFiles.length > 0}
                              onChange={toggleSelectAll}
                              className="h-4 w-4 rounded border-zinc-300 accent-blue-600"
                            />
                            <span className="text-xs text-zinc-500">Select all</span>
                          </div>
                          {filteredFiles.map((file) => {
                            const tone = getFileIconTone(file.extension);
                            return (
                              <div
                                key={file.path}
                                onClick={() => setDrawerFile(file)}
                                className={cn(
                                  "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition",
                                  selectedFiles.has(file.path)
                                    ? "border-blue-200 bg-blue-50/60"
                                    : "border-zinc-200 bg-white hover:border-blue-200 hover:bg-blue-50/40",
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedFiles.has(file.path)}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() => toggleFileSelection(file.path)}
                                  className="h-4 w-4 shrink-0 rounded border-zinc-300 accent-blue-600"
                                />
                                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1", tone)}>
                                  <FileIconComponent extension={file.extension} className="h-4 w-4" />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-zinc-900">{file.name}</p>
                                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                                    <span>{formatBytes(file.size)}</span>
                                    <span className="text-zinc-300">·</span>
                                    <span>{formatRelativeDate(file.updated_at)}</span>
                                  </div>
                                </div>
                                <FileStatusBadge status={file.status} />
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {filteredFiles.map((file) => {
                          const tone = getFileIconTone(file.extension);
                          return (
                            <div
                              key={file.path}
                              onClick={() => setDrawerFile(file)}
                              className="group cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white transition hover:border-blue-200 hover:shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-2 px-3 py-2.5">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1", tone)}>
                                    <FileIconComponent extension={file.extension} className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="truncate text-sm font-medium text-zinc-900">{file.name}</span>
                                </div>
                                <div className="relative">
                                  <input
                                    type="checkbox"
                                    checked={selectedFiles.has(file.path)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleFileSelection(file.path)}
                                    className={cn(
                                      "h-4 w-4 rounded border-zinc-300 accent-blue-600 transition-opacity",
                                      selectedFiles.has(file.path) ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                    )}
                                  />
                                </div>
                              </div>
                              <div className="flex h-32 items-center justify-center bg-zinc-50">
                                <span className={cn("grid h-16 w-16 place-items-center rounded-2xl ring-1", tone)}>
                                  <FileIconComponent extension={file.extension} className="h-8 w-8" />
                                </span>
                              </div>
                              <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">
                                <span className="truncate"><FileStatusBadge status={file.status} /></span>
                                <span>{formatBytes(file.size)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-blue-500/10 backdrop-blur-[1px]" aria-hidden="true">
          <div className="pointer-events-none m-3 flex h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-blue-500 bg-white/85 p-8 text-center shadow-sm">
            <div className="rounded-full bg-blue-100 p-3 text-blue-600">
              <UploadCloud className="h-7 w-7" />
            </div>
            <p className="text-base font-semibold text-zinc-800">Drop files to upload</p>
            <p className="text-xs text-zinc-500">Files will be added to {currentLocationName}</p>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {drawerFile && (
        <DetailDrawer
          file={drawerFile}
          workspaceId={workspaceId}
          onClose={() => setDrawerFile(null)}
          onPreview={(file) => setPreviewFile(file)}
          onRefresh={() => {
            fetchDocuments();
            setDrawerFile(null);
          }}
        />
      )}

      {previewFile && (
        <FilePreviewModal
          key={previewFile.path}
          file={previewFile}
          workspaceId={workspaceId}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* Create folder modal */}
      {showCreateFolder && (
        <CreateFolderModal
          onClose={() => setShowCreateFolder(false)}
          onCreated={handleCreateFolder}
        />
      )}

      {/* Add file modal */}
      {showUploadModal && (
        <AddFileModal
          workspaceId={workspaceId}
          currentPath={currentPath}
          initialFiles={droppedFiles}
          initialTab={droppedFiles.length > 0 ? "local" : "local"}
          onClose={() => {
            setShowUploadModal(false);
            setDroppedFiles([]);
          }}
          onUploaded={fetchDocuments}
        />
      )}
    </div>
  );
}
