export * from './postStatus';
export * from './nextPublishSlot';
export { LinkedInPostCard } from './LinkedInPostCard';
export type { LinkedInPostCardProps } from './LinkedInPostCard';
export { StatusStrip } from './StatusStrip';
export type { StatusStripProps } from './StatusStrip';

// ─── Phase 37 lesson-mode-ux ───────────────────────────────────────────────
// Plan 37-01 is the SOLE writer of this barrel for the entire phase. Plans
// 37-02 / 37-03 / 37-04 MUST NOT modify this file — they only replace the
// stub bodies of the files re-exported below. This eliminates a Wave-2
// write race on a single file.

// Plan 37-01 — shared primitives (real implementations land in this plan).
export { GenerationMetadata } from './GenerationMetadata';
export type { GenerationMetadataProps } from './GenerationMetadata';
export { StickyConfirmBar } from './StickyConfirmBar';
export type { StickyConfirmBarProps } from './StickyConfirmBar';

// Plan 37-02 — lesson selection (Plan 37-01 lands stubs; Plan 37-02 fills bodies).
export { LessonCandidateCard } from './LessonCandidateCard';
export { LessonGenerationModal } from './LessonGenerationModal';

// Plan 37-03 — variant finalization (Plan 37-01 lands stubs; Plan 37-03 fills bodies).
export { VariantCard } from './VariantCard';
export { VariantImageSlot } from './VariantImageSlot';
export type { VariantImageMode } from './VariantImageSlot';

// Plan 37-04 — queue integration (Plan 37-01 lands stub; Plan 37-04 fills body).
export { PendingActionEntryButton } from './PendingActionEntryButton';

// Plan 38-02 — new lesson run form (slide-out sheet from queue page).
export { NewLessonRunSheet } from './NewLessonRunSheet';
export type { NewLessonRunSheetProps } from './NewLessonRunSheet';
