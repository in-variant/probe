import { DocumentsView } from "@/components/documents-view";

export default async function WorkspaceDocumentsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <DocumentsView workspaceId={workspaceId} />;
}
