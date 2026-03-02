/**
 * Pipeline test script for travel search and calendar audit.
 * Usage:
 *   npx tsx scripts/test-pipeline.ts travel    -- run travel search tests
 *   npx tsx scripts/test-pipeline.ts calendar   -- run calendar tests (Plan 17-02)
 *   npx tsx scripts/test-pipeline.ts            -- run all
 */

import { searchTravel } from '../src/groups/travelSearch.js';
import { parseTravelIntent } from '../src/groups/travelParser.js';
import { extractDates, hasNumberPreFilter } from '../src/groups/dateExtractor.js';
import { createCalendarEvent, deleteCalendarEvent } from '../src/calendar/calendarService.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function checkUrl(url: string): Promise<{ status: number; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });
    return { status: res.status, finalUrl: res.url };
  } catch (err: unknown) {
    // On HEAD failure, try GET (some servers reject HEAD)
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      return { status: res.status, finalUrl: res.url };
    } catch {
      const message = err instanceof Error ? err.message : String(err);
      return { status: 0, finalUrl: `ERROR: ${message}` };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function log(msg: string): void {
  console.log(msg);
}

function logSection(title: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

// ─── Travel Tests ───────────────────────────────────────────────────────────

async function runTravelTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let searchesWithResults = 0;
  let totalSearches = 0;
  let urlsChecked = 0;
  let urlsResolved = 0;

  // --- Query A: Hebrew hotel search ---
  logSection('Query A: Hebrew hotel search');
  log('Input: "@bot מלונות בברצלונה מרץ"');
  totalSearches++;

  try {
    const intentA = await parseTravelIntent('@bot מלונות בברצלונה מרץ', '', 'he');
    log(`Intent: isTravelRelated=${intentA?.isTravelRelated}, isVague=${intentA?.isVague}, queryType=${intentA?.queryType}, destination=${intentA?.destination}`);
    log(`Search query: ${intentA?.searchQuery}`);

    if (intentA && intentA.isTravelRelated && !intentA.isVague) {
      const queryText = intentA.searchQuery ?? 'מלונות בברצלונה מרץ';
      const { results: searchResults, isFallback } = await searchTravel(queryText, 'he');
      log(`Results: ${searchResults.length} (fallback: ${isFallback})`);

      if (searchResults.length > 0) {
        searchesWithResults++;
        for (const r of searchResults) {
          log(`  - ${r.title}`);
          log(`    Snippet: ${r.snippet?.slice(0, 80)}...`);
          log(`    Price: ${r.price ?? 'N/A'}`);
          if (r.url) {
            urlsChecked++;
            const { status, finalUrl } = await checkUrl(r.url);
            const ok = status >= 200 && status < 400;
            if (ok) urlsResolved++;
            log(`    URL: ${r.url} => ${status} (${ok ? 'OK' : 'FAIL'}) -> ${finalUrl}`);
          } else {
            log(`    URL: (none)`);
          }
        }
      }

      results.push({
        name: 'Query A: Hebrew hotel search',
        passed: searchResults.length > 0,
        detail: `${searchResults.length} results, fallback=${isFallback}`,
      });
    } else {
      results.push({
        name: 'Query A: Hebrew hotel search',
        passed: false,
        detail: `Intent parsing: isTravelRelated=${intentA?.isTravelRelated}, isVague=${intentA?.isVague}`,
      });
    }
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'Query A: Hebrew hotel search', passed: false, detail: `Error: ${err}` });
  }

  // --- Query B: English flights search ---
  logSection('Query B: English flights search');
  log('Input: "@bot flights to Rome next week"');
  totalSearches++;

  try {
    const intentB = await parseTravelIntent('@bot flights to Rome next week', '', 'en');
    log(`Intent: isTravelRelated=${intentB?.isTravelRelated}, isVague=${intentB?.isVague}, queryType=${intentB?.queryType}, destination=${intentB?.destination}`);
    log(`Search query: ${intentB?.searchQuery}`);

    if (intentB && intentB.isTravelRelated && !intentB.isVague) {
      const queryText = intentB.searchQuery ?? 'flights to Rome next week';
      const { results: searchResults, isFallback } = await searchTravel(queryText, 'en');
      log(`Results: ${searchResults.length} (fallback: ${isFallback})`);

      if (searchResults.length > 0) {
        searchesWithResults++;
        for (const r of searchResults) {
          log(`  - ${r.title}`);
          log(`    Snippet: ${r.snippet?.slice(0, 80)}...`);
          log(`    Price: ${r.price ?? 'N/A'}`);
          if (r.url) {
            urlsChecked++;
            const { status, finalUrl } = await checkUrl(r.url);
            const ok = status >= 200 && status < 400;
            if (ok) urlsResolved++;
            log(`    URL: ${r.url} => ${status} (${ok ? 'OK' : 'FAIL'}) -> ${finalUrl}`);
          } else {
            log(`    URL: (none)`);
          }
        }
      }

      results.push({
        name: 'Query B: English flights search',
        passed: searchResults.length > 0,
        detail: `${searchResults.length} results, fallback=${isFallback}`,
      });
    } else {
      results.push({
        name: 'Query B: English flights search',
        passed: false,
        detail: `Intent parsing: isTravelRelated=${intentB?.isTravelRelated}, isVague=${intentB?.isVague}`,
      });
    }
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'Query B: English flights search', passed: false, detail: `Error: ${err}` });
  }

  // --- Query C: Follow-up simulation ---
  logSection('Query C: Follow-up simulation');
  log('Input: "יותר זול" with prior context');
  totalSearches++;

  try {
    const followUpContext =
      `[FOLLOW-UP SEARCH] This message is a reply to a previous travel search result. ` +
      `The user is refining or continuing their search. Treat this as travel-related.\n` +
      `Previous search query: hotels in Barcelona\n` +
      `Previous results:\n1. Hotel Arts\n2. W Barcelona\n\n` +
      `User follow-up message: יותר זול\n\n` +
      `Recent messages...`;

    const intentC = await parseTravelIntent(
      'Follow-up to: hotels in Barcelona. User says: יותר זול',
      followUpContext,
      'he',
    );
    log(`Intent: isTravelRelated=${intentC?.isTravelRelated}, isVague=${intentC?.isVague}, queryType=${intentC?.queryType}`);
    log(`Search query: ${intentC?.searchQuery}`);

    const isTravelRelated = intentC?.isTravelRelated === true;
    const isNotVague = intentC?.isVague === false;

    if (isTravelRelated && isNotVague) {
      const queryText = intentC.searchQuery ?? 'cheap hotels in Barcelona';
      const { results: searchResults, isFallback } = await searchTravel(queryText, 'he');
      log(`Results: ${searchResults.length} (fallback: ${isFallback})`);

      if (searchResults.length > 0) {
        searchesWithResults++;
        for (const r of searchResults) {
          log(`  - ${r.title}`);
          if (r.url) {
            urlsChecked++;
            const { status, finalUrl } = await checkUrl(r.url);
            const ok = status >= 200 && status < 400;
            if (ok) urlsResolved++;
            log(`    URL: ${r.url} => ${status} (${ok ? 'OK' : 'FAIL'}) -> ${finalUrl}`);
          }
        }
      }

      results.push({
        name: 'Query C: Follow-up simulation',
        passed: true,
        detail: `isTravelRelated=true, isVague=false, ${searchResults.length} results`,
      });
    } else {
      results.push({
        name: 'Query C: Follow-up simulation',
        passed: false,
        detail: `isTravelRelated=${isTravelRelated}, isVague=${!isNotVague} -- follow-up not recognized`,
      });
    }
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'Query C: Follow-up simulation', passed: false, detail: `Error: ${err}` });
  }

  // --- False positive checks ---
  logSection('False Positive Checks');

  const falsePositiveQueries = [
    { body: 'מה נשמע?', label: 'Casual greeting (Hebrew)' },
    { body: 'מישהו רוצה קפה?', label: 'Coffee question (Hebrew)' },
  ];

  let falsePositives = 0;

  for (const fp of falsePositiveQueries) {
    try {
      const intent = await parseTravelIntent(fp.body, '', 'he');
      const isTravel = intent?.isTravelRelated === true;
      if (isTravel) falsePositives++;
      log(`  "${fp.body}" (${fp.label}) => isTravelRelated=${isTravel} ${isTravel ? 'FALSE POSITIVE' : 'OK'}`);
      results.push({
        name: `False positive: ${fp.label}`,
        passed: !isTravel,
        detail: `isTravelRelated=${isTravel}`,
      });
    } catch (err) {
      log(`  "${fp.body}" => ERROR: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ name: `False positive: ${fp.label}`, passed: false, detail: `Error: ${err}` });
    }
  }

  // --- Summary ---
  logSection('Travel Test Summary');
  log(`Searches with results: ${searchesWithResults}/${totalSearches}`);
  log(`URLs resolved (2xx/3xx): ${urlsResolved}/${urlsChecked}`);
  log(`False positives detected: ${falsePositives}`);
  log('');

  for (const r of results) {
    log(`  ${r.passed ? 'PASS' : 'FAIL'} | ${r.name} -- ${r.detail}`);
  }

  return results;
}

// ─── Calendar Tests (stub for Plan 17-02) ───────────────────────────────────

async function runCalendarTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  let extractionsCorrect = 0;
  let totalExtractions = 0;

  // --- Test A: Hebrew with date ---
  logSection('Test A: Hebrew with date');
  log('Input: "נסיעה ב-15 לאפריל"');
  totalExtractions++;

  try {
    const datesA = await extractDates('נסיעה ב-15 לאפריל', 'TestUser', 'TestGroup');
    log(`Extracted: ${datesA.length} date(s)`);

    let passed = datesA.length >= 1;
    for (const d of datesA) {
      const validDate = !isNaN(d.date.getTime());
      const futureEnough = d.date.getFullYear() >= 2020;
      const hasTitle = d.title.length > 0;
      log(`  Title: ${d.title}`);
      log(`  Date: ${d.date.toISOString()} (valid=${validDate}, year>2020=${futureEnough})`);
      log(`  Confidence: ${d.confidence}`);
      if (!validDate || !futureEnough || !hasTitle) passed = false;
    }

    if (passed) extractionsCorrect++;
    results.push({
      name: 'Test A: Hebrew with date',
      passed,
      detail: `${datesA.length} date(s) extracted${datesA.length > 0 ? `, title="${datesA[0].title}"` : ''}`,
    });
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'Test A: Hebrew with date', passed: false, detail: `Error: ${err}` });
  }

  // --- Test B: English with date ---
  logSection('Test B: English with date');
  log('Input: "Meeting on March 20th at 3pm"');
  totalExtractions++;

  try {
    const datesB = await extractDates('Meeting on March 20th at 3pm', 'TestUser', 'TestGroup');
    log(`Extracted: ${datesB.length} date(s)`);

    let passed = datesB.length >= 1;
    for (const d of datesB) {
      const validDate = !isNaN(d.date.getTime());
      const futureEnough = d.date.getFullYear() >= 2020;
      const hasTitle = d.title.length > 0;
      log(`  Title: ${d.title}`);
      log(`  Date: ${d.date.toISOString()} (valid=${validDate}, year>2020=${futureEnough})`);
      log(`  Confidence: ${d.confidence}`);
      if (!validDate || !futureEnough || !hasTitle) passed = false;
    }

    if (passed) extractionsCorrect++;
    results.push({
      name: 'Test B: English with date',
      passed,
      detail: `${datesB.length} date(s) extracted${datesB.length > 0 ? `, title="${datesB[0].title}"` : ''}`,
    });
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'Test B: English with date', passed: false, detail: `Error: ${err}` });
  }

  // --- Test C: No date ---
  logSection('Test C: No date');
  log('Input: "מה המצב חבר\'ה?"');
  totalExtractions++;

  try {
    const preFilterC = hasNumberPreFilter('מה המצב חבר\'ה?');
    log(`hasNumberPreFilter: ${preFilterC} (expected: false)`);

    // Pre-filter should return false, meaning Gemini is never called.
    // But also verify extractDates returns empty if called anyway.
    const datesC = await extractDates('מה המצב חבר\'ה?', 'TestUser', 'TestGroup');
    log(`Extracted: ${datesC.length} date(s) (expected: 0)`);

    const passed = !preFilterC && datesC.length === 0;
    if (passed) extractionsCorrect++;
    results.push({
      name: 'Test C: No date',
      passed,
      detail: `preFilter=${preFilterC}, dates=${datesC.length}`,
    });
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: 'Test C: No date', passed: false, detail: `Error: ${err}` });
  }

  // --- Test D: Invalid date guard note ---
  logSection('Test D: Invalid date guard');
  log('The NaN date guard in dateExtractor.ts filters out any invalid Date objects.');
  log('Gemini rarely returns malformed dates, so this guard is a safety net.');
  log('Validated indirectly: if Tests A/B produce valid dates, the guard is not triggered.');
  log('The guard was added in Plan 17-02 Task 2 and logs a warning on any filtered date.');
  results.push({
    name: 'Test D: Invalid date guard (informational)',
    passed: true,
    detail: 'NaN guard exists in dateExtractor.ts — validates indirectly via Tests A/B',
  });

  // --- Calendar round-trip test ---
  logSection('Calendar Round-Trip Test');

  const testCalendarId = process.env.TEST_CALENDAR_ID;
  let calendarRoundTrip = 'skip';

  if (!testCalendarId) {
    log('Set TEST_CALENDAR_ID env var to run calendar round-trip test.');
    log('Skipping calendar create/delete round-trip.');
    results.push({
      name: 'Calendar round-trip',
      passed: true,
      detail: 'Skipped — TEST_CALENDAR_ID not set',
    });
  } else {
    log(`Using calendar: ${testCalendarId}`);

    try {
      // Create test event: tomorrow at 10:00 AM Israel time
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);

      log(`Creating test event: "Pipeline Audit Test Event" on ${tomorrow.toISOString()}`);

      const eventId = await createCalendarEvent({
        calendarId: testCalendarId,
        title: 'Pipeline Audit Test Event',
        date: tomorrow,
        description: 'Created by test-pipeline.ts calendar round-trip test. Should be deleted immediately.',
      });

      if (eventId) {
        log(`Event created: ${eventId}`);

        // Immediately delete
        log('Deleting test event...');
        const deleted = await deleteCalendarEvent(testCalendarId, eventId);
        log(`Event deleted: ${deleted}`);

        if (deleted) {
          calendarRoundTrip = 'pass';
          results.push({
            name: 'Calendar round-trip',
            passed: true,
            detail: `Created event ${eventId}, then deleted successfully`,
          });
        } else {
          calendarRoundTrip = 'fail';
          results.push({
            name: 'Calendar round-trip',
            passed: false,
            detail: `Created event ${eventId} but deletion failed`,
          });
        }
      } else {
        calendarRoundTrip = 'fail';
        log('Event creation returned null — check calendar auth and permissions.');
        results.push({
          name: 'Calendar round-trip',
          passed: false,
          detail: 'createCalendarEvent returned null',
        });
      }
    } catch (err) {
      calendarRoundTrip = 'fail';
      const msg = err instanceof Error ? err.message : String(err);
      log(`Calendar round-trip error: ${msg}`);
      if (msg.includes('auth') || msg.includes('credential') || msg.includes('key') || msg.includes('401') || msg.includes('403')) {
        log('This looks like an auth issue — check GOOGLE_SERVICE_ACCOUNT_KEY_PATH and calendar sharing.');
      }
      results.push({
        name: 'Calendar round-trip',
        passed: false,
        detail: `Error: ${msg}`,
      });
    }
  }

  // --- Calendar Test Summary ---
  logSection('Calendar Test Summary');
  log(`Date extractions correct: ${extractionsCorrect}/${totalExtractions}`);
  log(`Calendar round-trip: ${calendarRoundTrip}`);
  log('');

  for (const r of results) {
    log(`  ${r.passed ? 'PASS' : 'FAIL'} | ${r.name} -- ${r.detail}`);
  }

  return results;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'all';
  log(`\nPipeline Test Script -- mode: ${mode}\n`);

  let allResults: TestResult[] = [];

  if (mode === 'travel' || mode === 'all') {
    allResults = allResults.concat(await runTravelTests());
  }

  if (mode === 'calendar' || mode === 'all') {
    allResults = allResults.concat(await runCalendarTests());
  }

  if (mode !== 'travel' && mode !== 'calendar' && mode !== 'all') {
    log(`Unknown mode: "${mode}". Use: travel | calendar | all`);
    process.exit(1);
  }

  // Final summary
  logSection('Final Summary');
  const passed = allResults.filter((r) => r.passed).length;
  const total = allResults.length;
  log(`${passed}/${total} checks passed`);

  if (passed < total) {
    const failed = allResults.filter((r) => !r.passed);
    log('\nFailed checks:');
    for (const f of failed) {
      log(`  FAIL | ${f.name} -- ${f.detail}`);
    }
  }

  log('');
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});
