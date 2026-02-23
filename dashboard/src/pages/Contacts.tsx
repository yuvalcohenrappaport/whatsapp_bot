import { Users } from 'lucide-react';

export default function Contacts() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Contacts</h1>
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Users className="size-12 mb-4 opacity-50" />
        <p className="text-lg">No contacts yet</p>
        <p className="text-sm mt-1">Contacts will appear here once configured</p>
      </div>
    </div>
  );
}
