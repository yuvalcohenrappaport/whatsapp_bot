import '@testing-library/jest-dom/vitest';

// jsdom does NOT implement matchMedia. Every test that touches useViewport,
// useIsMobile, or any component depending on viewport breakpoints needs this.
// Mirror the same shape window.matchMedia returns in real browsers so
// event listeners fire on resize.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
