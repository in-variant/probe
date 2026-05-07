import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(dateStr);
}

export function getFileIcon(extension: string): string {
  const icons: Record<string, string> = {
    pdf: "FileText",
    doc: "FileText",
    docx: "FileText",
    txt: "FileText",
    md: "FileText",
    png: "Image",
    jpg: "Image",
    jpeg: "Image",
    gif: "Image",
    svg: "Image",
    webp: "Image",
    mp4: "Film",
    mov: "Film",
    avi: "Film",
    mp3: "Music",
    wav: "Music",
    zip: "Archive",
    rar: "Archive",
    tar: "Archive",
    gz: "Archive",
    js: "FileCode",
    ts: "FileCode",
    py: "FileCode",
    java: "FileCode",
    css: "FileCode",
    html: "FileCode",
    json: "FileCode",
    xls: "Sheet",
    xlsx: "Sheet",
    csv: "Sheet",
    ppt: "Presentation",
    pptx: "Presentation",
  };
  return icons[extension] || "File";
}

export function getFileIconTone(extension: string): string {
  const ext = extension.toLowerCase();
  if (["pdf"].includes(ext)) return "bg-rose-50 text-rose-600 ring-rose-100";
  if (["doc", "docx", "txt", "md", "rtf"].includes(ext)) return "bg-sky-50 text-sky-600 ring-sky-100";
  if (["xls", "xlsx", "csv"].includes(ext)) return "bg-emerald-50 text-emerald-600 ring-emerald-100";
  if (["ppt", "pptx", "key"].includes(ext)) return "bg-amber-50 text-amber-600 ring-amber-100";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "bg-violet-50 text-violet-600 ring-violet-100";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "bg-indigo-50 text-indigo-600 ring-indigo-100";
  if (["mp4", "mov", "avi", "mkv"].includes(ext)) return "bg-pink-50 text-pink-600 ring-pink-100";
  if (["mp3", "wav", "flac", "aac"].includes(ext)) return "bg-orange-50 text-orange-600 ring-orange-100";
  if (["js", "ts", "py", "java", "css", "html", "json"].includes(ext)) return "bg-cyan-50 text-cyan-600 ring-cyan-100";
  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}
