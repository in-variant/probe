import { getAuthToken } from "@/lib/auth";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(path, {
    ...options,
    headers,
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
  file_count?: number;
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

export interface CommentAuthor {
  email: string;
  name: string;
}

export interface CommentThreadEntry {
  id: string;
  body: string;
  created_by: CommentAuthor;
  created_at: string;
}

export interface DocumentComment {
  id: string;
  file_path: string;
  anchor_text?: string | null;
  start_line?: number | null;
  end_line?: number | null;
  status: "open" | "resolved";
  created_by: CommentAuthor;
  created_at: string;
  resolved_by?: CommentAuthor | null;
  resolved_at?: string | null;
  thread: CommentThreadEntry[];
}

export type MemberRole = "ADMIN" | "CLIENT" | "INVARIANT";

export interface MemberRoleRecord {
  email: string;
  role: MemberRole;
  allowed: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

// ── Workspace API ──────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
  const data = await request<{ workspaces: Workspace[] }>("/api/workspaces");
  return data.workspaces;
}

export async function createWorkspace(
  name: string,
  status: string = "active",
  googleDriveFolderId?: string,
): Promise<Workspace> {
  const payload: Record<string, string> = { name, status };
  if (googleDriveFolderId) payload.google_drive_folder_id = googleDriveFolderId;
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

export async function listMembers(): Promise<{ members: MemberRoleRecord[]; roles: MemberRole[] }> {
  return request("/api/auth/members");
}

export async function updateMemberRole(email: string, role: MemberRole): Promise<MemberRoleRecord> {
  return request("/api/auth/members", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, role }),
  });
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
    const authToken = getAuthToken();
    if (authToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${authToken}`);
    }
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

export async function writeTextFile(
  workspaceId: string,
  path: string,
  content: string,
  contentType: string = "text/markdown"
): Promise<{ path: string; size: number; content_type: string }> {
  return request(`/api/workspaces/${workspaceId}/files/text`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, content_type: contentType }),
  });
}

export interface KnowledgeBaseStatus {
  workspace_id: string;
  sync: {
    hydrated: boolean;
    state: "ready" | "hydrating";
  };
  knowledge_base: {
    state: "ready" | "indexing" | "error";
    file_count: number;
    indexable_file_count: number;
    indexed_chunk_count: number;
    queue_depth: number;
    pending_count: number;
    running_count: number;
    processed_count: number;
    failed_count: number;
    last_error?: Record<string, unknown> | null;
  };
}

export async function getKnowledgeBaseStatus(workspaceId: string): Promise<KnowledgeBaseStatus> {
  return request(`/api/workspaces/${workspaceId}/knowledge-base/status`);
}

/** Shown in admin UI and required verbatim for wipe-chroma. Must match backend WIPE_CONFIRMATION_PHRASE. */
export const ADMIN_WIPE_CHROMA_PHRASE = "DELETE CHROMA" as const;

export async function adminReindexWorkspace(
  workspaceId: string,
): Promise<{ workspace_id: string; enqueued: number }> {
  return request("/api/admin/rag/reindex-workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: workspaceId }),
  });
}

export async function adminWipeChroma(
  confirmationPhrase: string,
): Promise<{ deleted_collections: number }> {
  return request("/api/admin/rag/wipe-chroma", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: confirmationPhrase }),
  });
}

export async function listFileComments(workspaceId: string, path: string): Promise<DocumentComment[]> {
  const params = new URLSearchParams({ path });
  const data = await request<{ file_path: string; comments: DocumentComment[] }>(
    `/api/workspaces/${workspaceId}/files/comments?${params}`,
  );
  return data.comments;
}

export async function createFileComment(
  workspaceId: string,
  path: string,
  payload: { body: string; anchor_text?: string | null; start_line?: number | null; end_line?: number | null },
): Promise<DocumentComment> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/files/comments?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function replyToFileComment(
  workspaceId: string,
  path: string,
  commentId: string,
  body: string,
): Promise<CommentThreadEntry> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/files/comments/${commentId}/replies?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function updateFileCommentStatus(
  workspaceId: string,
  path: string,
  commentId: string,
  status: "open" | "resolved",
): Promise<DocumentComment> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/files/comments/${commentId}?${params}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export async function getDownloadUrl(
  workspaceId: string,
  path: string
): Promise<{ url: string; expires_in: number }> {
  const params = new URLSearchParams({ path });
  return request(`/api/workspaces/${workspaceId}/files/download-url?${params}`);
}

export async function getFileTextContent(
  workspaceId: string,
  path: string
): Promise<string> {
  const params = new URLSearchParams({ path });
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`/api/workspaces/${workspaceId}/files/content?${params}`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.text();
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

export async function browseGDriveFolder(
  folderId: string = "root"
): Promise<GDriveBrowseResponse> {
  const params = new URLSearchParams({ folder_id: folderId });
  return request(`/api/gdrive/folders?${params}`);
}

export interface GDriveImportResult {
  imported_count: number;
  error_count: number;
  imported?: { name: string; path: string; size: number }[];
  errors?: { name: string; error: string }[];
}

export async function importGDriveFolder(
  workspaceId: string,
  folderId: string,
  recursive: boolean = true,
  targetPath: string = "/"
): Promise<GDriveImportResult> {
  return request(`/api/gdrive/import/${workspaceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId, recursive, target_path: targetPath }),
  });
}

export async function importGDriveSelection(
  workspaceId: string,
  options: {
    parent_folder_id: string;
    file_ids?: string[];
    folder_ids?: string[];
    target_path?: string;
  }
): Promise<GDriveImportResult> {
  return request(`/api/gdrive/import/${workspaceId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parent_folder_id: options.parent_folder_id,
      file_ids: options.file_ids ?? [],
      folder_ids: options.folder_ids ?? [],
      target_path: options.target_path ?? "/",
    }),
  });
}

export async function uploadAndExtractZip(
  workspaceId: string,
  zipFile: File,
  path: string = "/",
): Promise<{ folder_path: string; imported_count: number }> {
  const formData = new FormData();
  formData.append("file", zipFile);
  formData.append("path", path);

  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/api/workspaces/${workspaceId}/files/import-zip`, {
    method: "POST",
    body: formData,
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Document requests (Invariant ↔ Client) ─────────────────────

export interface RequestComment {
  id: string;
  author_email: string;
  author_name: string;
  body: string;
  created_at: string;
  replies: RequestCommentReply[];
}

export interface RequestCommentReply {
  id: string;
  author_email: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface DocumentRequest {
  id: string;
  created_by_email: string;
  created_by_name: string;
  created_at: string;
  title: string;
  body: string;
  desired_path: string;
  status: string;
  assignee_email?: string | null;
  assignee_name?: string | null;
  fulfilled_by_email?: string | null;
  fulfilled_at?: string | null;
  stored_path?: string | null;
  comments?: RequestComment[];
}

export async function listDocumentRequests(workspaceId: string): Promise<DocumentRequest[]> {
  return request(`/api/workspaces/${workspaceId}/document-requests`);
}

export async function createDocumentRequest(
  workspaceId: string,
  payload: { title: string; body?: string; desired_path?: string; assignee_email?: string },
): Promise<DocumentRequest> {
  return request(`/api/workspaces/${workspaceId}/document-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function cancelDocumentRequest(workspaceId: string, requestId: string): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/document-requests/${requestId}`, {
    method: "PATCH",
  });
}

export async function deleteDocumentRequest(workspaceId: string, requestId: string): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/document-requests/${requestId}`, {
    method: "DELETE",
  });
}

export async function fulfillDocumentRequest(
  workspaceId: string,
  requestId: string,
  file: File,
): Promise<{ stored_path: string; request: DocumentRequest }> {
  const formData = new FormData();
  formData.append("file", file);
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(`/api/workspaces/${workspaceId}/document-requests/${requestId}/fulfill`, {
    method: "POST",
    body: formData,
    headers,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function assignDocumentRequest(
  workspaceId: string,
  requestId: string,
  assigneeEmail: string | null,
): Promise<DocumentRequest> {
  return request(`/api/workspaces/${workspaceId}/document-requests/${requestId}/assign`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignee_email: assigneeEmail }),
  });
}

export async function listRequestComments(
  workspaceId: string,
  requestId: string,
): Promise<{ comments: RequestComment[] }> {
  return request(`/api/workspaces/${workspaceId}/document-requests/${requestId}/comments`);
}

export async function createRequestComment(
  workspaceId: string,
  requestId: string,
  body: string,
): Promise<RequestComment> {
  return request(`/api/workspaces/${workspaceId}/document-requests/${requestId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
}

export async function replyToRequestComment(
  workspaceId: string,
  requestId: string,
  commentId: string,
  body: string,
): Promise<RequestCommentReply> {
  return request(
    `/api/workspaces/${workspaceId}/document-requests/${requestId}/comments/${commentId}/replies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}

// ── Compliance roadmap (INVARIANT + ADMIN) ───────────────────────

export interface ComplianceRoadmapTask {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  file_paths: string[];
  links: string[];
}

export interface ComplianceRoadmapPhase {
  id: string;
  name: string;
  order: number;
  tasks: ComplianceRoadmapTask[];
}

export interface ComplianceRoadmap {
  phases: ComplianceRoadmapPhase[];
  updated_at: string | null;
}

export async function getComplianceRoadmap(workspaceId: string): Promise<ComplianceRoadmap> {
  return request(`/api/workspaces/${workspaceId}/compliance-roadmap`);
}

export async function patchComplianceRoadmap(
  workspaceId: string,
  payload: { phases: ComplianceRoadmapPhase[] },
): Promise<ComplianceRoadmap> {
  return request(`/api/workspaces/${workspaceId}/compliance-roadmap`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
