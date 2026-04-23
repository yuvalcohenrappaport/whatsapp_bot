import * as React from 'react';
import { cn } from '@/lib/utils';
import { useViewport } from '@/hooks/useViewport';

type StickyActionBarProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Pins its children to the bottom of the viewport on phone with safe-area
 * padding so the bar doesn't sit under the iOS home indicator. On desktop,
 * renders inline (static) so existing forms layouts don't shift.
 *
 * Usage:
 *   <StickyActionBar>
 *     <Button onClick={save}>Save</Button>
 *   </StickyActionBar>
 *
 * On phone the bar gets a backdrop blur + top border so content scrolling
 * behind it stays readable.
 */
export function StickyActionBar({ className, children, ...rest }: StickyActionBarProps) {
  const { isMobile } = useViewport();
  if (!isMobile) {
    return (
      <div className={cn('flex items-center gap-2 mt-4', className)} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-center gap-2',
        'border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        'px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
