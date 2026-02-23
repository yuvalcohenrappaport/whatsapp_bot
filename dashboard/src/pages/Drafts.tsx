import { MessageSquare } from 'lucide-react';

export default function Drafts() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Drafts</h1>
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <MessageSquare className="size-12 mb-4 opacity-50" />
        <p className="text-lg">No pending drafts</p>
        <p className="text-sm mt-1">Draft replies will appear here for approval</p>
      </div>
    </div>
  );
}
