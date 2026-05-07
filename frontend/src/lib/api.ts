async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Workspace types ────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  status: "active" | "on-hold" | "completed";
  created_at: string;
  updated_at: string;
  file_count: number;
  folder_count: number;
  gdrive_import_status?: "importing" | "completed" | "failed";
  gdrive_imported_count?: number;
  gdrive_total_count?: number;
  google_drive_folder_id?: string;
}

// ── Document types ─────────────────────────────────────────────

export interface FolderItem {
  name: string;
  type: "folder";
  path: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface FileItem {
  name: string;
  type: "file";
  path: string;
  size: number;
  content_type: string;
  extension: string;
  created_at: string | null;
  updated_at: string | null;
  status: string;
}

export type DocumentItem = FolderItem | FileItem;

// ── Workspace API ──────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
  const data = await request<{ workspaces: Workspace[] }>("/api/workspaces");
  return data.workspaces;
}

export async function createWorkspace(
  name: string,
  status: string = "active",
  googleDriveFolderId?: string,
  gdriveSessionToken?: string,
): Promise<Workspace> {
  const payload: Record<string, string> = { name, status };
  if (googleDriveFolderId) payload.google_drive_folder_id = googleDriveFolderId;
  if (gdriveSessionToken) payload.gdrive_session_token = gdriveSessionToken;
  return request<Workspace>("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return request<Workspace>(`/api/workspaces/${id}`);
}

export async function updateWorkspace(
  id: string,
  data: { name?: string; status?: string }
): Promise<Workspace> {
  return request<Workspace>(`/api/workspaces/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteWorkspace(id: string): Promise<void> {
  await request(`/api/workspaces/${id}`, { method: "DELETE" });
}

// ── Documents API ──────────────────────────────────────────────

export async function listDocuments(
  workspaceId: string,
  path: string = "/"
): Promise<{ folders: FolderItem[]; files: FileItem[] }> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/documents?${params}`);
}

export async function createFolder(
  workspaceId: string,
  name: string,
  path: string = "/"
): Promise<FolderItem> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/folders?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function renameFolder(
  workspaceId: string,
  path: string,
  newName: string
): Promise<{ renamed: boolean; new_path: string }> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/folders?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
}

export async function deleteFolder(
  workspaceId: string,
  path: string
): Promise<void> {
  const params = new URLSearchParams({ path });
  await request(`/api/workspaces/${workspaceId}/folders?${params}`, {
    method: "DELETE",
  });
}

export function uploadFilesWithProgress(
  workspaceId: string,
  files: File[],
  path: string = "/",
  status: string = "uploaded",
  onProgress?: (loaded: number, total: number) => void
): { promise: Promise<{ uploaded: FileItem[] }>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  formData.append("path", path);
  formData.append("status", status);

  const promise = new Promise<{ uploaded: FileItem[] }>((resolve, reject) => {
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total);
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.open("POST", `/api/workspaces/${workspaceId}/files`);
    xhr.send(formData);
  });

  return { promise, abort: () => xhr.abort() };
}

export async function getFileDetails(
  workspaceId: string,
  path: string
): Promise<FileItem & { metadata: Record<string, string> }> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/files?${params}`);
}

export async function updateFile(
  workspaceId: string,
  path: string,
  data: { status?: string; name?: string }
): Promise<void> {
  const params = new URLSearchParams({ path });
  await request(`/api/workspaces/${workspaceId}/files?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteFile(
  workspaceId: string,
  path: string
): Promise<void> {
  const params = new URLSearchParams({ path });
  await request(`/api/workspaces/${workspaceId}/files?${params}`, {
    method: "DELETE",
  });
}

export async function bulkDeleteFiles(
  workspaceId: string,
  paths: string[]
): Promise<{ deleted: string[] }> {
  return request(`/api/workspaces/${workspaceId}/files/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
}

export async function moveFiles(
  workspaceId: string,
  sourcePaths: string[],
  destinationFolder: string
): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/files/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_paths: sourcePaths,
      destination_folder: destinationFolder,
    }),
  });
}

export async function getDownloadUrl(
  workspaceId: string,
  path: string
): Promise<{ url: string; expires_in: number }> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/files/download-url?${params}`);
}

// ── Search / Knowledge Base API ─────────────────────────────────

export interface SearchResult {
  path: string;
  name: string;
  relevance: string;
  score: number;
  size?: number;
  content_type?: string;
  status?: string;
}

export interface SearchResponse {
  interaction_id: string;
  results: SearchResult[];
  message: string;
  summary: string;
}

export async function searchDocuments(
  workspaceId: string,
  query: string,
  sessionId: string
): Promise<SearchResponse> {
  return request<SearchResponse>("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId, query, session_id: sessionId }),
  });
}

// ── Google Drive API ────────────────────────────────────────────

export interface GDriveFolder {
  id: string;
  name: string;
  mimeType: string;
}

export interface GDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime?: string;
}

export interface GDriveBrowseResponse {
  folder_id: string;
  folders: GDriveFolder[];
  files: GDriveFile[];
}

export async function getGDriveAuthUrl(state: string = ""): Promise<{ url: string; flow_id: string }> {
  const origin = window.location.origin;
  const params = new URLSearchParams({ origin, state });
  return request(`/api/gdrive/auth-url?${params}`);
}

export async function exchangeGDriveCode(code: string, flowId: string): Promise<{ session_token: string }> {
  const origin = window.location.origin;
  return request("/api/gdrive/callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, origin, flow_id: flowId }),
  });
}

export async function browseGDriveFolder(
  sessionToken: string,
  folderId: string = "root"
): Promise<GDriveBrowseResponse> {
  const params = new URLSearchParams({ session_token: sessionToken, folder_id: folderId });
  return request(`/api/gdrive/folders?${params}`);
}

export async function importGDriveFolder(
  workspaceId: string,
  sessionToken: string,
  folderId: string,
  recursive: boolean = true
): Promise<{ imported_count: number; error_count: number }> {
  return request(`/api/gdrive/import/${workspaceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_token: sessionToken, folder_id: folderId, recursive }),
  });
}
