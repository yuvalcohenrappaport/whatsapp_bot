import { useState } from 'react';
import { toast } from 'sonner';
import { Send, Trash2, X } from 'lucide-react';
import {
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useUpdateGroup, useDeleteGroup, useSendGroupMessage } from '@/hooks/useGroups';
import type { Group } from '@/hooks/useGroups';
import { KeywordRuleList } from './KeywordRuleList';

function buildWelcomeMessage(calendarLink: string | null): string {
  const calendarLine = calendarLink
    ? `\nלוח השנה של הקבוצה:\n${calendarLink}`
    : '';

  return `\u{202B}היי לכולם! 👋

הבוט של הקבוצה כאן כדי לעזור לתכנן את החופשה. הנה מה שאני יודע לעשות:

✈️ *חיפוש טיולים*
תייגו אותי עם בקשה ואני אחפש בשבילכם ברגע:
• טיסות לרומא בחודש הבא
• מלונות בברצלונה 10-15 במרץ
• מסעדות ליד מגדל אייפל
• השכרת רכב באתונה

אפשר גם להגיב על תוצאה שקיבלתם ולשאול שאלת המשך — אני אזכור את ההקשר.

📅 *לוח שנה משותף*
כל פעם שמישהו כותב תאריך בקבוצה (למשל "הטיסה ב-15 למרץ בשעה 10:00"), אני אוסיף את זה אוטומטית ללוח שנה של Google ואשלח אישור. רוצים למחוק אירוע? פשוט הגיבו על ההודעה שלי עם "מחק" או ❌.${calendarLine}

🔔 *תקציר שבועי*
כל שבוע אני שולח סיכום של מה שקורה — אירועים קרובים, משימות פתוחות ונקודות עיקריות מהשיחה.

💬 *טיפים*
• אפשר לכתוב בעברית או באנגלית — אני מבין שניהם
• בין חיפושים יש המתנה קצרה של 30 שניות
• לא צריך להוסיף אירועים ידנית — פשוט כתבו תאריכים בצ'אט ואני אתפוס אותם

יאללה, לאן טסים? ✈️`;
}

interface GroupPanelProps {
  group: Group;
  onClose: () => void;
}

const DAYS = [
  'none',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

function parseEmails(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((e): e is string => typeof e === 'string');
  } catch {
    // ignore parse errors
  }
  return [];
}

export function GroupPanel({ group, onClose }: GroupPanelProps) {
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const sendMessage = useSendGroupMessage();

  const [name, setName] = useState(group.name ?? '');
  const [calendarLink, setCalendarLink] = useState(group.calendarLink ?? '');
  const [emails, setEmails] = useState<string[]>(parseEmails(group.memberEmails));
  const [newEmail, setNewEmail] = useState('');

  function handleNameBlur() {
    const trimmed = name.trim() || null;
    if (trimmed !== group.name) {
      updateGroup.mutate(
        { id: group.id, patch: { name: trimmed } },
        { onSuccess: () => toast.success('Saved') },
      );
    }
  }

  function handleTravelBotToggle(checked: boolean) {
    updateGroup.mutate(
      { id: group.id, patch: { travelBotActive: checked } },
      { onSuccess: () => toast.success('Saved') },
    );
  }

  function handleKeywordRulesToggle(checked: boolean) {
    updateGroup.mutate(
      { id: group.id, patch: { keywordRulesActive: checked } },
      { onSuccess: () => toast.success('Saved') },
    );
  }

  function handleReminderDayChange(value: string) {
    const day = value === 'none' ? null : value;
    updateGroup.mutate(
      { id: group.id, patch: { reminderDay: day } },
      { onSuccess: () => toast.success('Saved') },
    );
  }

  function handleCalendarLinkBlur() {
    const trimmed = calendarLink.trim() || null;
    if (trimmed !== group.calendarLink) {
      updateGroup.mutate(
        { id: group.id, patch: { calendarLink: trimmed } },
        { onSuccess: () => toast.success('Saved') },
      );
    }
  }

  function saveEmails(updated: string[]) {
    setEmails(updated);
    updateGroup.mutate(
      { id: group.id, patch: { memberEmails: JSON.stringify(updated) } },
      { onSuccess: () => toast.success('Saved') },
    );
  }

  function handleAddEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    if (emails.includes(trimmed)) {
      toast.error('Email already added');
      return;
    }
    saveEmails([...emails, trimmed]);
    setNewEmail('');
  }

  function handleRemoveEmail(email: string) {
    saveEmails(emails.filter((e) => e !== email));
  }

  function handleDelete() {
    deleteGroup.mutate(group.id, {
      onSuccess: () => {
        toast.success('Group deleted');
        onClose();
      },
    });
  }

  return (
    <div className="flex flex-col h-full">
      <SheetHeader>
        <SheetTitle>{group.name ?? group.id}</SheetTitle>
        <SheetDescription>{group.id}</SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 p-4">
        {/* Name */}
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameBlur}
            placeholder="Group name"
          />
        </div>

        {/* Feature toggles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Travel Bot</Label>
            <Switch
              checked={group.travelBotActive}
              onCheckedChange={handleTravelBotToggle}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Keyword Rules</Label>
            <Switch
              checked={group.keywordRulesActive}
              onCheckedChange={handleKeywordRulesToggle}
            />
          </div>
        </div>

        <Separator />

        {/* Reminder day */}
        <div className="space-y-2">
          <Label>Reminder Day</Label>
          <Select
            value={group.reminderDay ?? 'none'}
            onValueChange={handleReminderDayChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAYS.map((day) => (
                <SelectItem key={day} value={day}>
                  {day === 'none' ? 'None' : day.charAt(0).toUpperCase() + day.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Calendar link */}
        <div className="space-y-2">
          <Label>Calendar Link</Label>
          <Input
            value={calendarLink}
            onChange={(e) => setCalendarLink(e.target.value)}
            onBlur={handleCalendarLinkBlur}
            placeholder="https://calendar.google.com/..."
          />
        </div>

        <Separator />

        {/* Member emails */}
        <div className="space-y-3">
          <Label>Member Emails</Label>
          {emails.length > 0 && (
            <div className="space-y-2">
              {emails.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between bg-muted rounded-md px-3 py-2 text-sm"
                >
                  <span className="truncate">{email}</span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => handleRemoveEmail(email)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
              placeholder="email@example.com"
              className="flex-1"
            />
            <Button size="sm" variant="outline" onClick={handleAddEmail}>
              Add
            </Button>
          </div>
        </div>

        <Separator />

        {/* Welcome Message */}
        <div className="space-y-3">
          <Label>Welcome Message</Label>
          <div
            dir="rtl"
            className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed"
          >
            {buildWelcomeMessage(group.calendarLink)}
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={sendMessage.isPending}
            onClick={() => {
              sendMessage.mutate(
                { id: group.id, text: buildWelcomeMessage(group.calendarLink) },
                {
                  onSuccess: () => toast.success('Welcome message sent'),
                  onError: () => toast.error('Failed to send message'),
                },
              );
            }}
          >
            <Send className="size-4 mr-2" />
            {sendMessage.isPending ? 'Sending...' : 'Send to Group'}
          </Button>
        </div>

        <Separator />
        <KeywordRuleList groupJid={group.id} />
      </div>

      <div className="p-4 border-t border-border">
        <Button
          variant="destructive"
          className="w-full"
          onClick={handleDelete}
          disabled={deleteGroup.isPending}
        >
          <Trash2 className="size-4 mr-2" />
          Delete Group
        </Button>
      </div>
    </div>
  );
}
