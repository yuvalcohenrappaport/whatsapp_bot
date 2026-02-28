# Requirements: WhatsApp Bot

**Defined:** 2026-02-28
**Core Value:** The bot replies to WhatsApp messages in the user's authentic voice, so contacts can't tell the difference.

## v1.3 Requirements

Requirements for voice response milestone. Each maps to roadmap phases.

### Voice Pipeline

- [ ] **VOICE-01**: Bot receives and downloads incoming voice messages from whitelisted contacts
- [ ] **VOICE-02**: Bot transcribes voice messages to text via ElevenLabs Scribe v2 (Hebrew supported)
- [ ] **VOICE-03**: Bot generates AI text reply from transcription using existing Gemini pipeline
- [ ] **VOICE-04**: Bot converts text reply to speech via ElevenLabs TTS with cloned voice (`eleven_v3` model)
- [ ] **VOICE-05**: Bot sends voice reply as WhatsApp PTT voice note (OGG/Opus, `ptt: true`)

### Contact Configuration

- [ ] **CONF-01**: User can enable/disable voice replies per contact
- [ ] **CONF-02**: Contacts with voice disabled still get text replies to voice messages (transcribe → text reply)

### Draft Integration

- [ ] **DRAFT-01**: Voice replies follow contact's existing mode (auto-send or draft queue)
- [ ] **DRAFT-02**: Draft queue shows text transcript of voice reply for review
- [ ] **DRAFT-03**: Audio is generated at approval time (lazy TTS), not at draft creation

### Management

- [ ] **MGMT-01**: User can toggle voice reply setting per contact in dashboard
- [ ] **MGMT-02**: User can toggle voice reply setting per contact in CLI

## Future Requirements

### Voice Enhancements

- **VFUT-01**: Voice reply latency optimization (streaming TTS)
- **VFUT-02**: Voice message support in groups
- **VFUT-03**: Voice style learning from user's voice messages

## Out of Scope

| Feature | Reason |
|---------|--------|
| Voice replies in groups | Groups are utility-only; voice is for private impersonation |
| Real-time voice calls | Far beyond current Baileys capabilities |
| Multiple voice clones | Single user, single voice |
| Voice message forwarding | Not part of the impersonation use case |
| Eager TTS at draft creation | Temp file loss risk on restart; lazy TTS is safer |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VOICE-01 | Phase 14 | Pending |
| VOICE-02 | Phase 13 | Pending |
| VOICE-03 | Phase 14 | Pending |
| VOICE-04 | Phase 13 | Pending |
| VOICE-05 | Phase 14 | Pending |
| CONF-01 | Phase 16 | Pending |
| CONF-02 | Phase 14 | Pending |
| DRAFT-01 | Phase 15 | Pending |
| DRAFT-02 | Phase 15 | Pending |
| DRAFT-03 | Phase 15 | Pending |
| MGMT-01 | Phase 16 | Pending |
| MGMT-02 | Phase 16 | Pending |

**Coverage:**
- v1.3 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-03-01 after v1.3 roadmap creation*
