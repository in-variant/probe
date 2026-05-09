"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Check, Code2, Heading1, Heading2, ImageIcon, List, ListOrdered, MessageSquare, Minus, Pilcrow, Save } from "lucide-react";

import { getDownloadUrl, type DocumentComment } from "@/lib/api";
import { MarkdownImageInsertModal } from "@/components/document-editor/markdown-image-insert-modal";
import { cn } from "@/lib/utils";

/** Persists workspace-relative paths in markdown; `src` holds a signed URL for display when possible. */
const WorkspaceImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      workspacePath: {
        default: null,
      },
    };
  },
  parseMarkdown: (token, helpers) => {
    const href = token.href;
    return helpers.createNode("image", {
      src: href,
      title: token.title,
      alt: token.text,
      workspacePath: typeof href === "string" && href.startsWith("uploads/") ? href : null,
    });
  },
  renderMarkdown(node) {
    const alt = node.attrs?.alt ?? "";
    const title = node.attrs?.title ?? "";
    const wp = node.attrs?.workspacePath as string | null | undefined;
    const src = (node.attrs?.src as string) ?? "";
    const out =
      wp && wp.length > 0 ? wp : src.startsWith("uploads/") ? src : src;
    return title ? `![${alt}](${out} "${title}")` : `![${alt}](${out})`;
  },
}).configure({ inline: false, allowBase64: true });

async function resolveWorkspaceImageUrls(editor: Editor, workspaceId: string) {
  const doc = editor.state.doc;
  const pending: { pos: number; rel: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "image") return;
    const attrs = node.attrs as { src?: string; workspacePath?: string | null };
    const rel = attrs.workspacePath || (attrs.src?.startsWith("uploads/") ? attrs.src : null);
    if (!rel) return;
    const src = attrs.src || "";
    if (src.startsWith("http://") || src.startsWith("https://")) return;
    pending.push({ pos, rel });
  });
  if (pending.length === 0) return;
  const updates: { pos: number; attrs: Record<string, unknown> }[] = [];
  for (const p of pending) {
    try {
      const { url } = await getDownloadUrl(workspaceId, p.rel);
      const node = editor.state.doc.nodeAt(p.pos);
      if (!node || node.type.name !== "image") continue;
      updates.push({
        pos: p.pos,
        attrs: {
          ...node.attrs,
          src: url,
          workspacePath: p.rel,
        },
      });
    } catch {
      /* keep raw path in src */
    }
  }
  if (updates.length === 0) return;
  const tr = editor.state.tr;
  for (const u of updates) {
    tr.setNodeMarkup(u.pos, undefined, u.attrs);
  }
  editor.view.dispatch(tr);
}

type SaveStatus = "saved" | "dirty" | "saving" | "error";

type SlashCommand = {
  id: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  run: (editor: Editor, from: number, to: number) => void;
};

const baseSlashCommands: SlashCommand[] = [
  {
    id: "h1",
    label: "Heading 1",
    description: "Large section title",
    icon: Heading1,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).setNode("heading", { level: 1 }).run(),
  },
  {
    id: "h2",
    label: "Heading 2",
    description: "Medium section title",
    icon: Heading2,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).setNode("heading", { level: 2 }).run(),
  },
  {
    id: "paragraph",
    label: "Paragraph",
    description: "Plain text block",
    icon: Pilcrow,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).setNode("paragraph").run(),
  },
  {
    id: "divider",
    label: "Divider",
    description: "Horizontal rule",
    icon: Minus,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).setHorizontalRule().run(),
  },
  {
    id: "bullet",
    label: "Bullet List",
    description: "Unordered list",
    icon: List,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).toggleBulletList().run(),
  },
  {
    id: "numbered",
    label: "Numbered List",
    description: "Ordered list",
    icon: ListOrdered,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).toggleOrderedList().run(),
  },
  {
    id: "code",
    label: "Code Block",
    description: "Preformatted code",
    icon: Code2,
    run: (editor, from, to) => editor.chain().focus().deleteRange({ from, to }).toggleCodeBlock().run(),
  },
];

function findSlashRange(editor: Editor): { from: number; to: number; filter: string } | null {
  const { state } = editor;
  const { $from, from } = state.selection;

  let blockStart = -1;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.isTextblock) {
      blockStart = $from.start(d);
      break;
    }
  }
  if (blockStart < 0) return null;

  /** Scan backward inside this block only — avoids broken slashPos when mixing H1 text + `/cmd` across blocks. */
  let scan = from - 1;
  while (scan >= blockStart) {
    const ch = state.doc.textBetween(scan, scan + 1);
    if (ch === "/") {
      const filter = state.doc.textBetween(scan + 1, from);
      if (filter.includes(" ") || filter.includes("\n")) {
        scan--;
        continue;
      }
      if (scan > blockStart) {
        const charBefore = state.doc.textBetween(scan - 1, scan);
        if (charBefore.length > 0 && !/\s/.test(charBefore)) {
          scan--;
          continue;
        }
      }
      return { from: scan, to: from, filter };
    }
    scan--;
  }
  return null;
}

export function DocumentMarkdownLiveEditor({
  path,
  content,
  saveStatus,
  comments = [],
  onChange,
  onSave,
  workspaceId = "",
  onWorkspaceFilesChanged,
  onCreateComment,
  onReplyComment,
  onToggleCommentStatus,
}: {
  path: string;
  content: string;
  saveStatus: SaveStatus;
  comments?: DocumentComment[];
  onChange: (content: string) => void;
  onSave: () => void;
  /** Required for image insert (uploads to workspace) and resolving `uploads/…` image paths in the editor. */
  workspaceId?: string;
  onWorkspaceFilesChanged?: () => void;
  onCreateComment?: (anchorText: string) => void;
  onReplyComment?: (commentId: string, body: string) => void;
  onToggleCommentStatus?: (commentId: string, status: "open" | "resolved") => void;
}) {
  const [slashRange, setSlashRange] = useState<{ from: number; to: number; filter: string } | null>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [selectedText, setSelectedText] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const pendingImageSlashRef = useRef<{ from: number; to: number } | null>(null);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      ...baseSlashCommands,
      {
        id: "image",
        label: "Image",
        description: "Device, URL, or Google Drive",
        icon: ImageIcon,
        run: (_editor, from, to) => {
          if (!workspaceId) return;
          pendingImageSlashRef.current = { from, to };
          setImageModalOpen(true);
        },
      },
    ],
    [workspaceId],
  );

  const filter = slashRange?.filter.toLowerCase() ?? "";
  const filteredCommands = slashCommands.filter(
    (command) => !filter || command.label.toLowerCase().includes(filter) || command.id.includes(filter),
  );
  const slashRangeRef = useRef(slashRange);
  const activeSlashIndexRef = useRef(activeSlashIndex);
  const filteredCommandsRef = useRef(filteredCommands);
  const applyingExternalContentRef = useRef(false);
  /** Last markdown emitted by the editor; avoids setContent on every parent re-render when it only echoes this value. */
  const lastMarkdownFromEditorRef = useRef("");
  const syncedEditorPathRef = useRef(path);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const slashMenuContextKeyRef = useRef("");
  const editorScrollRef = useRef<HTMLDivElement>(null);
  /** TipTap keeps the initial `editorProps.handleKeyDown` closure; `editor` can be null there while hooks already expose the instance. */
  const editorRef = useRef<Editor | null>(null);
  const [slashMenuViewportPos, setSlashMenuViewportPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
  }, [onChange, onSave]);

  useEffect(() => {
    slashRangeRef.current = slashRange;
    activeSlashIndexRef.current = activeSlashIndex;
    filteredCommandsRef.current = filteredCommands;
  }, [activeSlashIndex, filteredCommands, slashRange]);

  /** Reset keyboard highlight when the slash fragment / anchor changes (not on every sync). */
  useEffect(() => {
    const key = slashRange ? `${slashRange.from}:${slashRange.filter}` : "";
    if (key === slashMenuContextKeyRef.current) return;
    slashMenuContextKeyRef.current = key;
    setActiveSlashIndex(0);
  }, [slashRange]);

  const extensions = useMemo(
    () => [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Type "/" for blocks, "# " for headings, or start writing...',
      }),
      WorkspaceImage,
      Markdown.configure({ markedOptions: { gfm: true } }),
    ],
    [],
  );

  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class:
            "document-live-editor prose prose-zinc max-w-none min-h-full px-8 py-6 text-sm leading-5 outline-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-2xl prose-h1:mb-2 prose-h1:mt-1 prose-h2:text-lg prose-h2:mb-2 prose-h2:mt-4 prose-h3:text-base prose-h3:mb-1 prose-h3:mt-3 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-hr:my-3 prose-code:text-xs",
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            onSaveRef.current();
            return true;
          }
          const currentSlashRange = slashRangeRef.current;
          if (currentSlashRange) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveSlashIndex((idx) => Math.min(idx + 1, filteredCommandsRef.current.length - 1));
              return true;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveSlashIndex((idx) => Math.max(idx - 1, 0));
              return true;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const ed = editorRef.current;
              const command = filteredCommandsRef.current[activeSlashIndexRef.current];
              if (ed && !ed.isDestroyed && command) {
                command.run(ed, currentSlashRange.from, currentSlashRange.to);
                setSlashRange(null);
              }
              return true;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setSlashRange(null);
              return true;
            }
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (applyingExternalContentRef.current) return;
        const md = ed.getMarkdown();
        lastMarkdownFromEditorRef.current = md;
        onChangeRef.current(md);
        setSlashRange(findSlashRange(ed));
      },
      onSelectionUpdate: ({ editor: ed }) => {
        setSlashRange(findSlashRange(ed));
        const { from, to } = ed.state.selection;
        setSelectedText(ed.state.doc.textBetween(from, to, " ").trim());
      },
    },
    [extensions],
  );

  editorRef.current = editor;

  /** Pin slash menu to the caret; `absolute bottom-left` was tied to the panel, not the cursor. */
  useLayoutEffect(() => {
    if (!editor || !slashRange) {
      setSlashMenuViewportPos(null);
      return;
    }
    const update = () => {
      try {
        const coords = editor.view.coordsAtPos(slashRange.to);
        setSlashMenuViewportPos({ top: coords.bottom + 6, left: coords.left });
      } catch {
        setSlashMenuViewportPos(null);
      }
    };
    update();
    const scroller = editorScrollRef.current;
    scroller?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [editor, slashRange]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;

    const finish = () => {
      if (!cancelled) applyingExternalContentRef.current = false;
    };

    const run = async () => {
      applyingExternalContentRef.current = true;
      if (syncedEditorPathRef.current !== path) {
        syncedEditorPathRef.current = path;
        editor.commands.setContent(content, { contentType: "markdown" });
        lastMarkdownFromEditorRef.current = editor.getMarkdown();
        if (workspaceId && !cancelled) await resolveWorkspaceImageUrls(editor, workspaceId);
        finish();
        return;
      }
      if (content === lastMarkdownFromEditorRef.current) {
        finish();
        return;
      }
      editor.commands.setContent(content, { contentType: "markdown" });
      lastMarkdownFromEditorRef.current = editor.getMarkdown();
      if (workspaceId && !cancelled) await resolveWorkspaceImageUrls(editor, workspaceId);
      finish();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [content, editor, path, workspaceId]);

  const statusLabel =
    saveStatus === "saving" ? "Saving" : saveStatus === "dirty" ? "Unsaved" : saveStatus === "error" ? "Error" : "Saved";

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-white">
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-800">{path}</p>
          <p className="text-[11px] text-zinc-400">Live markdown · Save or Ctrl+S (no autosave)</p>
        </div>
        <div className="flex items-center gap-2">
          {onCreateComment && (
            <button
              type="button"
              onClick={() => onCreateComment(selectedText)}
              disabled={!selectedText}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              title={selectedText ? "Comment on selection" : "Select text to comment"}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Comment
            </button>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]",
              saveStatus === "error"
                ? "bg-red-50 text-red-700"
                : saveStatus === "dirty"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700",
            )}
          >
            {saveStatus === "saved" && <Check className="h-3 w-3" />}
            {statusLabel}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === "saving"}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          ref={editorScrollRef}
          className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          <EditorContent editor={editor} />
        </div>
        {comments.length > 0 && (
          <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50">
            <div className="shrink-0 border-b border-zinc-200 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">Comments</p>
              <p className="text-[11px] text-zinc-400">{comments.length} thread{comments.length === 1 ? "" : "s"}</p>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-xl border border-zinc-200 bg-white p-2 text-xs shadow-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-zinc-800">{comment.created_by.name || comment.created_by.email}</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        comment.status === "resolved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                      )}
                    >
                      {comment.status}
                    </span>
                  </div>
                  {comment.anchor_text && (
                    <blockquote className="mb-2 line-clamp-3 border-l-2 border-blue-200 pl-2 text-[11px] leading-4 text-zinc-500">
                      {comment.anchor_text}
                    </blockquote>
                  )}
                  <div className="space-y-1.5">
                    {comment.thread.map((entry) => (
                      <div key={entry.id} className="rounded-lg bg-zinc-50 px-2 py-1.5">
                        <p className="text-[11px] font-medium text-zinc-600">{entry.created_by.name || entry.created_by.email}</p>
                        <p className="whitespace-pre-wrap leading-4 text-zinc-700">{entry.body}</p>
                      </div>
                    ))}
                  </div>
                  <textarea
                    value={replyDrafts[comment.id] ?? ""}
                    onChange={(event) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: event.target.value }))}
                    placeholder="Reply..."
                    rows={2}
                    className="mt-2 w-full resize-none rounded-lg border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-zinc-300"
                  />
                  <div className="mt-2 flex justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onToggleCommentStatus?.(comment.id, comment.status === "resolved" ? "open" : "resolved")}
                      className="rounded-lg border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50"
                    >
                      {comment.status === "resolved" ? "Reopen" : "Resolve"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const body = (replyDrafts[comment.id] ?? "").trim();
                        if (!body) return;
                        onReplyComment?.(comment.id, body);
                        setReplyDrafts((prev) => ({ ...prev, [comment.id]: "" }));
                      }}
                      className="rounded-lg bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-700"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
      {editor && slashRange && filteredCommands.length > 0 && slashMenuViewportPos && (
        <div
          className="fixed z-40 w-72 max-w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white p-1 shadow-xl"
          style={{
            top: slashMenuViewportPos.top,
            left: slashMenuViewportPos.left,
          }}
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Blocks</div>
          {filteredCommands.map((command, index) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  const ed = editorRef.current ?? editor;
                  if (!ed || ed.isDestroyed) return;
                  command.run(ed, slashRange.from, slashRange.to);
                  setSlashRange(null);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs",
                  index === activeSlashIndex ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-50",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{command.label}</span>
                  <span className={cn("block truncate", index === activeSlashIndex ? "text-zinc-300" : "text-zinc-400")}>
                    {command.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {workspaceId ? (
        <MarkdownImageInsertModal
          workspaceId={workspaceId}
          open={imageModalOpen}
          onClose={() => {
            pendingImageSlashRef.current = null;
            setImageModalOpen(false);
          }}
          onReady={({ workspacePath, displaySrc, alt }) => {
            const ed = editorRef.current;
            if (!ed || ed.isDestroyed) return;
            const range = pendingImageSlashRef.current;
            pendingImageSlashRef.current = null;
            setImageModalOpen(false);
            const chain = ed.chain().focus();
            if (range) {
              chain.deleteRange({ from: range.from, to: range.to });
            }
            chain
              .insertContent({
                type: "image",
                attrs: { src: displaySrc, alt, workspacePath },
              })
              .run();
          }}
          onUploaded={onWorkspaceFilesChanged}
        />
      ) : null}
    </div>
  );
}

