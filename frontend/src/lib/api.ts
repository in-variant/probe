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
  status: string = "active"
): Promise<Workspace> {
  return request<Workspace>("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, status }),
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
