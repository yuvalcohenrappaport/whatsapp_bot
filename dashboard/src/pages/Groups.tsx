import { UsersRound } from 'lucide-react';

export default function Groups() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Groups</h1>
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <UsersRound className="size-12 mb-4 opacity-50" />
        <p className="text-lg">No tracked groups</p>
        <p className="text-sm mt-1">Groups will appear here once configured</p>
      </div>
    </div>
  );
}
