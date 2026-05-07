"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  FileText,
  Check,
  Loader2,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
import {
  getGDriveAuthUrl,
  exchangeGDriveCode,
  browseGDriveFolder,
  type GDriveFolder,
  type GDriveFile,
} from "@/lib/api";

interface GoogleDrivePickerProps {
  onSelect: (folderId: string, folderName: string, sessionToken: string) => void;
  onClear: () => void;
  selectedFolderId?: string;
  selectedFolderName?: string;
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

export function GoogleDrivePicker({
  onSelect,
  onClear,
  selectedFolderId,
  selectedFolderName,
}: GoogleDrivePickerProps) {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [folders, setFolders] = useState<GDriveFolder[]>([]);
  const [files, setFiles] = useState<GDriveFile[]>([]);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: "root", name: "My Drive" },
  ]);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flowIdRef = useRef<string>("");

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1]?.id ?? "root";

  const loadFolder = useCallback(
    async (folderId: string) => {
      if (!sessionToken) return;
      setLoading(true);
      try {
        const data = await browseGDriveFolder(sessionToken, folderId);
        setFolders(data.folders);
        setFiles(data.files);
      } catch {
        setFolders([]);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionToken]
  );

  useEffect(() => {
    if (showBrowser && sessionToken) {
      loadFolder(currentFolderId);
    }
  }, [showBrowser, sessionToken, currentFolderId, loadFolder]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function handleConnect() {
    setConnecting(true);
    localStorage.removeItem("gdrive_auth_code");
    localStorage.removeItem("gdrive_auth_error");
    try {
      const { url, flow_id } = await getGDriveAuthUrl("connect");
      flowIdRef.current = flow_id;
      const popup = window.open(url, "gdrive-auth", "width=520,height=680,popup=1");
      popupRef.current = popup;

      pollRef.current = setInterval(() => {
        const code = localStorage.getItem("gdrive_auth_code");
        const error = localStorage.getItem("gdrive_auth_error");

        if (code) {
          localStorage.removeItem("gdrive_auth_code");
          if (pollRef.current) clearInterval(pollRef.current);
          if (popup && !popup.closed) popup.close();
          handleCodeExchange(code);
          return;
        }

        if (error) {
          localStorage.removeItem("gdrive_auth_error");
          if (pollRef.current) clearInterval(pollRef.current);
          if (popup && !popup.closed) popup.close();
          setConnecting(false);
          return;
        }

        if (!popup || popup.closed) {
          if (pollRef.current) clearInterval(pollRef.current);
          setConnecting(false);
        }
      }, 500);
    } catch {
      setConnecting(false);
    }
  }

  async function handleCodeExchange(code: string) {
    try {
      const { session_token } = await exchangeGDriveCode(code, flowIdRef.current);
      setSessionToken(session_token);
      setShowBrowser(true);
    } catch {
      // exchange failed
    } finally {
      setConnecting(false);
    }
  }

  function navigateInto(folder: GDriveFolder) {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function navigateTo(index: number) {
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  }

  function handleSelectFolder() {
    if (!sessionToken) return;
    const current = breadcrumbs[breadcrumbs.length - 1];
    onSelect(current.id, current.name, sessionToken);
    setShowBrowser(false);
  }

  function handleDisconnect() {
    setSessionToken(null);
    setShowBrowser(false);
    setFolders([]);
    setFiles([]);
    setBreadcrumbs([{ id: "root", name: "My Drive" }]);
    onClear();
  }

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
          onClick={(e) => {
            e.preventDefault();
            onClear();
          }}
          className="rounded-lg p-1.5 text-emerald-500 transition-colors hover:bg-emerald-100 hover:text-emerald-700"
          title="Remove Google Drive link"
        >
          <Unlink className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (showBrowser && sessionToken) {
    return (
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        {/* Header with breadcrumbs */}
        <div className="flex items-center gap-1 border-b border-zinc-200 bg-zinc-50 px-3 py-2">
          <DriveLogo size={14} />
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-xs">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.id} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="h-3 w-3 text-zinc-300" />}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateTo(i);
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
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleDisconnect();
            }}
            className="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600"
          >
            Disconnect
          </button>
        </div>

        {/* Folder listing */}
        <div className="max-h-52 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
            </div>
          ) : folders.length === 0 && files.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-400">
              This folder is empty
            </div>
          ) : (
            <div>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    navigateInto(folder);
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50"
                >
                  <Folder className="h-4 w-4 shrink-0 text-blue-500" />
                  <span className="min-w-0 flex-1 truncate text-zinc-700">{folder.name}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-300" />
                </button>
              ))}
              {files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm opacity-50"
                >
                  <FileText className="h-4 w-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-zinc-500">{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs text-zinc-400">
            {folders.length} folder{folders.length !== 1 ? "s" : ""}, {files.length} file
            {files.length !== 1 ? "s" : ""}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handleSelectFolder();
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
      onClick={(e) => {
        e.preventDefault();
        handleConnect();
      }}
      disabled={connecting}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-3 py-3 text-left transition-colors",
        connecting
          ? "cursor-wait bg-zinc-50"
          : "cursor-pointer hover:border-blue-300 hover:bg-blue-50/50"
      )}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white">
        {connecting ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        ) : (
          <DriveLogo size={20} />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-700">
          {connecting ? "Connecting to Google Drive…" : "Connect Google Drive"}
        </p>
        <p className="text-xs text-zinc-400">Import files from a Drive folder</p>
      </div>
    </button>
  );
}
