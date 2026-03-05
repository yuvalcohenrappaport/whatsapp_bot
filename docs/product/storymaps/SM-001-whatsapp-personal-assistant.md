# SM-001: WhatsApp Personal Assistant & Group Organizer

> Date: 2026-03-05
> Source: DISC-001 / OA-001

## Narrative Flow (left to right = user journey)

### Activity 1: Personal Message Management (Owner)
| Task | Walking Skeleton (Current) | v1.0 (Optimized) | Future |
|------|---------------------------|-------------------|--------|
| Receive messages | Baileys captures all 1:1 messages | Same + priority/urgency detection | Smart notifications for truly urgent messages |
| AI-generated replies | Gemini generates replies in owner's voice | Improved persona accuracy, faster cold-start | Context-aware replies (knows your calendar, mood) |
| Approve/send drafts | Dashboard draft queue with approve/reject | Bulk approve, quick-edit before send | Confidence-based auto-send (high confidence = auto, low = draft) |
| Manage contacts | Per-contact reply mode (off/draft/auto) | Contact grouping, snooze schedules | AI-suggested contact settings based on patterns |
| Monitor conversations | Dashboard overview | Conversation summaries, unread highlights | Daily digest / morning briefing |

### Activity 2: Group Event Planning (Friends)
| Task | Walking Skeleton (Current) | v1.0 (Optimized) | Future |
|------|---------------------------|-------------------|--------|
| Extract dates from chat | Auto-detect dates in group messages | Better NLP — handles relative dates, ranges, ambiguity | Multi-language date extraction |
| Create calendar events | Auto-create Google Calendar events | Richer events (location, description from context) | Suggest optimal dates based on group availability |
| Confirm with group | In-group confirmation messages | Confirmation with RSVP tracking | Attendance tracking, waitlists |
| Send reminders | Weekly AI-generated task reminder digests | Smart reminders (closer to event = more frequent) | Personalized reminders per member |
| Handle changes | Manual — owner updates | Bot detects plan changes in chat and updates events | Conflict resolution, rebooking suggestions |

### Activity 3: Group Utilities (Friends)
| Task | Walking Skeleton (Current) | v1.0 (Optimized) | Future |
|------|---------------------------|-------------------|--------|
| Travel search | @mention triggers Gemini + Google Search | Richer results (prices, links, comparisons) | Proactive suggestions based on trip context |
| Keyword auto-responses | Per-group rules with cooldown | Smarter matching, AI-generated responses | Learning from group culture/inside jokes |
| Group insights | Basic message storage | Group activity summary in dashboard | Engagement analytics, quiet member nudges |

### Activity 4: Multi-User Platform (Future)
| Task | Walking Skeleton | v1.0 | Future |
|------|-----------------|------|--------|
| User onboarding | — | — | Self-service setup, QR auth per user |
| Personal assistant per user | — | — | Isolated instances, per-user persona learning |
| Admin controls | — | — | Usage limits, ban risk monitoring per instance |
| Billing/access | — | — | Friends-tier (free) vs wider access |

## Release Slices

### Walking Skeleton (Current State - Launching Next Week)
Horizontal slice across Activities 1-3. All core features exist and work:
- AI replies with persona learning (1:1)
- Date extraction + calendar events (groups)
- Confirmations + reminders (groups)
- Travel search + keyword rules (groups)
- React dashboard as control center

**Goal:** Validate with friend groups. Measure engagement and event creation.

### v1.0 (Post-Validation - Month 2-3)
Based on friend feedback, optimize the most-used features:
- Improve AI persona cold-start
- Smarter date extraction and richer calendar events
- RSVP tracking and smart reminders
- Dashboard conversation summaries
- Bulk draft management

**Goal:** Friends actively rely on the bot for planning. Owner is truly hands-free.

### Future (Month 6+)
Expand to multi-user if group features are validated:
- Personal assistant instances for friends
- Self-service onboarding
- Ban risk management at scale
- Context-aware AI (calendar + chat + preferences)

**Goal:** Each friend has their own WhatsApp assistant.

## Open Questions
- How will friends react to a bot posting in their groups? Is there social friction?
- What's the minimum persona training data needed before auto-mode produces acceptable replies?
- How does ban risk change with increased group activity (more messages from bot)?
- Should the bot announce itself as a bot, or stay invisible?
- What happens when date extraction gets it wrong — is the recovery flow smooth?
- How to handle groups where some members don't want bot interaction?
