"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  Folder,
  FileText,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  browseGDriveFolder,
  importGDriveFolder,
  importGDriveSelection,
  type GDriveFolder,
  type GDriveFile,
} from "@/lib/api";

function DriveLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
      <path d="m6.6 66.85 3.85 6.65c.8 1.45 1.95 2.65 3.3 3.55l13.75-23.8H.25c0 1.55.4 3.1 1.2 4.5z" fill="#0066DA"/>
      <path d="m43.65 25-13.75-23.8c-1.35.9-2.5 2.1-3.3 3.55L1.2 53.25H28.7z" fill="#00AC47"/>
      <path d="m73.55 76.8c1.35-.9 2.5-2.1 3.3-3.55l1.6-2.75 7.65-13.25c.8-1.45 1.2-3.1 1.2-4.5H59.8l5.85 13.25z" fill="#EA4335"/>
      <path d="m43.65 25 13.75-23.8c-1.35-.9-2.9-1.2-4.5-1.2H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832D"/>
      <path d="M59.8 53.25H27.5l-13.75 23.8c1.35.9 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684FC"/>
      <path d="M73.4 26.5 60.65 4.75c-.8-1.45-1.95-2.65-3.3-3.55L43.6 25l16.2 28.25H87.3c0-1.55-.4-3.1-1.2-4.5z" fill="#FFBA00"/>
    </svg>
  );
}

export { DriveLogo };

interface BreadcrumbItem {
  id: string;
  name: string;
}

/* ── Folder picker (for workspace create modal) ───────────────── */

interface GoogleDriveFolderPickerProps {
  onSelect: (folderId: string, folderName: string) => void;
  onClear: () => void;
  selectedFolderId?: string;
  selectedFolderName?: string;
}

export function GoogleDriveFolderPicker({
  onSelect,
  onClear,
  selectedFolderId,
  selectedFolderName,
}: GoogleDriveFolderPickerProps) {
  const [showBrowser, setShowBrowser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<GDriveFolder[]>([]);
  const [files, setFiles] = useState<GDriveFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: "root", name: "My Drive" },
  ]);

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1]?.id ?? "root";

  const loadFolder = useCallback(async (folderId: string) => {
    setLoading(true);
    try {
      const data = await browseGDriveFolder(folderId);
      setFolders(data.folders);
      setFiles(data.files);
    } catch {
      setFolders([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showBrowser) loadFolder(currentFolderId);
  }, [showBrowser, currentFolderId, loadFolder]);

  if (selectedFolderId && selectedFolderName) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white">
          <DriveLogo size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-emerald-800">{selectedFolderName}</p>
          <p className="text-xs text-emerald-600">Google Drive folder linked</p>
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onClear(); }}
          className="rounded-lg px-2 py-1 text-xs text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
        >
          Change
        </button>
      </div>
    );
  }

  if (showBrowser) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <div className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-3 py-2">
          <DriveLogo size={14} />
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.id} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300" />}
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setBreadcrumbs((p) => p.slice(0, i + 1)); }}
                  className={cn(
                    "rounded px-1 py-0.5 transition-colors",
                    i === breadcrumbs.length - 1
                      ? "font-medium text-zinc-800"
                      : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                  )}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setShowBrowser(false); }}
            className="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600"
          >
            Cancel
          </button>
        </div>

        <div className="max-h-52 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-400">This folder is empty</div>
          ) : (
            <div>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    setBreadcrumbs((p) => [...p, { id: folder.id, name: folder.name }]);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50"
                >
                  <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                  <span className="min-w-0 flex-1 truncate text-zinc-700">{folder.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                </button>
              ))}
              {files.map((file) => (
                <div key={file.id} className="flex items-center gap-2.5 px-3 py-2 text-sm opacity-50">
                  <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-400">
            {folders.length} folder{folders.length !== 1 ? "s" : ""}, {files.length} file{files.length !== 1 ? "s" : ""}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              const current = breadcrumbs[breadcrumbs.length - 1];
              onSelect(current.id, current.name);
              setShowBrowser(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Check className="h-3 w-3" />
            Select this folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); setShowBrowser(true); }}
      className="flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-left transition-colors cursor-pointer hover:border-blue-300 hover:bg-blue-50/50"
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white">
        <DriveLogo size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-700">Select Google Drive Folder</p>
        <p className="text-xs text-zinc-400">Import files from a Drive folder</p>
      </div>
    </button>
  );
}

/* ── Drive file browser (for importing into existing workspace) ── */

interface DriveFileBrowserProps {
  workspaceId: string;
  currentPath: string;
  onImportComplete: () => void;
}

export function DriveFileBrowser({
  workspaceId,
  currentPath,
  onImportComplete,
}: DriveFileBrowserProps) {
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [folders, setFolders] = useState<GDriveFolder[]>([]);
  const [files, setFiles] = useState<GDriveFile[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: "root", name: "My Drive" },
  ]);

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1]?.id ?? "root";

  function clearSelection() {
    setSelectedFileIds(new Set());
    setSelectedFolderIds(new Set());
  }

  const loadFolder = useCallback(async (folderId: string) => {
    setLoading(true);
    try {
      const data = await browseGDriveFolder(folderId);
      setFolders(data.folders);
      setFiles(data.files);
    } catch {
      setFolders([]);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolder(currentFolderId);
  }, [currentFolderId, loadFolder]);

  async function handleImportFolder() {
    setImporting(true);
    try {
      await importGDriveFolder(workspaceId, currentFolderId, true, currentPath);
      onImportComplete();
    } catch {
      // error handled by caller
    } finally {
      setImporting(false);
    }
  }

  async function handleImportSelection() {
    if (selectedFileIds.size === 0 && selectedFolderIds.size === 0) return;
    setImporting(true);
    try {
      await importGDriveSelection(workspaceId, {
        parent_folder_id: currentFolderId,
        file_ids: Array.from(selectedFileIds),
        folder_ids: Array.from(selectedFolderIds),
        target_path: currentPath,
      });
      onImportComplete();
    } catch {
      // error handled by caller
    } finally {
      setImporting(false);
    }
  }

  function toggleFile(fileId: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }

  function toggleFolder(folderId: string) {
    setSelectedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  const selectedCount = selectedFileIds.size + selectedFolderIds.size;

  return (
    <div className="flex flex-col">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-3 py-2 rounded-t-xl">
        <DriveLogo size={14} />
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs">
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300" />}
              <button
                type="button"
                onClick={() => {
                  clearSelection();
                  setBreadcrumbs((p) => p.slice(0, i + 1));
                }}
                className={cn(
                  "rounded px-1 py-0.5 transition-colors",
                  i === breadcrumbs.length - 1
                    ? "font-medium text-zinc-800"
                    : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                )}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-h-64 min-h-[12rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="py-10 text-center text-xs text-zinc-400">This folder is empty</div>
        ) : (
          <div>
            {folders.map((folder) => (
              <div key={folder.id} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={selectedFolderIds.has(folder.id)}
                  onChange={() => toggleFolder(folder.id)}
                  className="h-4 w-4 rounded border-zinc-300 accent-blue-600"
                />
                <button
                  type="button"
                  onClick={() => {
                    clearSelection();
                    setBreadcrumbs((p) => [...p, { id: folder.id, name: folder.name }]);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                  <span className="min-w-0 flex-1 truncate text-zinc-700">{folder.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                </button>
              </div>
            ))}
            {files.map((file) => (
              <div key={file.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={selectedFileIds.has(file.id)}
                  onChange={() => toggleFile(file.id)}
                  className="h-4 w-4 rounded border-zinc-300 accent-blue-600"
                />
                <FileText className="h-4 w-4 shrink-0 text-zinc-500" />
                <span className="min-w-0 flex-1 truncate text-zinc-600">{file.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 py-3 rounded-b-xl">
        <p className="text-xs text-zinc-400">
          {folders.length} folder{folders.length !== 1 ? "s" : ""}, {files.length} file{files.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleImportSelection}
            disabled={importing || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50"
          >
            {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Import selected {selectedCount > 0 ? `(${selectedCount})` : ""}
          </button>
          <button
            type="button"
            onClick={handleImportFolder}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {importing ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <Check className="h-3 w-3" />
                Import entire folder
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
