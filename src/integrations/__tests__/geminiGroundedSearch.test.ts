import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @google/genai before importing the module under test
const generateContentMock = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI(this: { models: { generateContent: typeof generateContentMock } }) {
    this.models = { generateContent: generateContentMock };
  }),
}));
vi.mock('../../config.js', () => ({
  config: { LOG_LEVEL: 'silent', GEMINI_API_KEY: 'fake', GEMINI_MODEL: 'gemini-2.5-flash' },
}));

const { transitAlerts } = await import('../geminiGroundedSearch.js');

beforeEach(() => generateContentMock.mockReset());

describe('transitAlerts', () => {
  it('returns first line of Gemini response', async () => {
    generateContentMock.mockResolvedValue({ text: 'Metro strike on Line 1 all day\nSource: ...' });
    const result = await transitAlerts('Rome', '2026-05-10');
    expect(result).toBe('Metro strike on Line 1 all day');
  });

  it('returns "normal" verbatim when Gemini says nothing notable', async () => {
    generateContentMock.mockResolvedValue({ text: 'normal' });
    const result = await transitAlerts('Tokyo', '2026-05-10');
    expect(result).toBe('normal');
  });

  it('returns null on empty Gemini response', async () => {
    generateContentMock.mockResolvedValue({ text: '' });
    const result = await transitAlerts('Paris', '2026-05-10');
    expect(result).toBeNull();
  });

  it('returns null (does not throw) on Gemini error', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('Gemini timeout'));
    await expect(transitAlerts('London', '2026-05-10')).resolves.toBeNull();
  });

  it('uses googleSearch tool binding (not googleMaps)', async () => {
    generateContentMock.mockResolvedValue({ text: 'normal' });
    await transitAlerts('Berlin', '2026-05-10');
    const callArg = generateContentMock.mock.calls[0][0];
    expect(callArg.config.tools).toEqual([{ googleSearch: {} }]);
    expect(JSON.stringify(callArg.config.tools)).not.toContain('googleMaps');
  });

  it('prompt contains destination and date verbatim', async () => {
    generateContentMock.mockResolvedValue({ text: 'normal' });
    await transitAlerts('Amsterdam', '2026-06-15');
    const callArg = generateContentMock.mock.calls[0][0];
    const prompt = callArg.contents[0].parts[0].text as string;
    expect(prompt).toContain('Amsterdam');
    expect(prompt).toContain('2026-06-15');
    expect(prompt).toContain('1-line summary');
  });
});
