import * as React from 'react';

export const VIEWPORT_BREAKPOINTS = {
  mobile: 768,   // matches MOBILE_BREAKPOINT in use-mobile.ts (Phase 50 design lock)
  tablet: 1024,  // tablet kept at desktop layout in Phase 50 (design non-goal)
} as const;

export type Viewport = {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

function compute(width: number): Viewport {
  const isMobile = width < VIEWPORT_BREAKPOINTS.mobile;
  const isTablet = !isMobile && width < VIEWPORT_BREAKPOINTS.tablet;
  const isDesktop = !isMobile && !isTablet;
  return { isMobile, isTablet, isDesktop };
}

export function useViewport(): Viewport {
  const [vp, setVp] = React.useState<Viewport>(() =>
    typeof window === 'undefined'
      ? { isMobile: false, isTablet: false, isDesktop: true }
      : compute(window.innerWidth),
  );

  React.useEffect(() => {
    const onChange = () => setVp(compute(window.innerWidth));
    // matchMedia listeners fire on the breakpoint crossing rather than
    // every pixel change — cheaper than a resize listener.
    const mqlMobile = window.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINTS.mobile - 1}px)`);
    const mqlTablet = window.matchMedia(`(max-width: ${VIEWPORT_BREAKPOINTS.tablet - 1}px)`);
    mqlMobile.addEventListener('change', onChange);
    mqlTablet.addEventListener('change', onChange);
    onChange(); // re-sync after mount in case window changed pre-effect
    return () => {
      mqlMobile.removeEventListener('change', onChange);
      mqlTablet.removeEventListener('change', onChange);
    };
  }, []);

  return vp;
}
