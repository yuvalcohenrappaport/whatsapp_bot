import { describe, it, expect } from 'vitest';
import { formatTravelResults } from '../travelFormatter.js';
import type { SearchResult } from '../travelSearch.js';

// --- Suite 1: Restaurant rendering ---

describe('formatTravelResults — restaurants', () => {
  it('renders all-fields-present fixture (en)', () => {
    const results: SearchResult[] = [
      {
        title: 'Osteria Francescana',
        url: 'https://maps.google.com/maps?cid=1',
        snippet: 'Top restaurant',
        price: null,
        rating: 4.9,
        reviewCount: 1200,
        address: 'Via Stella 22, Modena',
        photoUrl: 'https://example.com/photo1.jpg',
        openNow: true,
        priceLevel: '$$$',
        cuisine: 'Italian',
        reservationUrl: 'https://opentable.com/osteria-francescana',
      },
      {
        title: 'Da Enzo al 29',
        url: 'https://maps.google.com/maps?cid=2',
        snippet: 'Roman trattoria',
        price: null,
        rating: 4.7,
        reviewCount: 845,
        address: 'Via dei Vascellari 29, Rome',
        photoUrl: 'https://example.com/photo2.jpg',
        openNow: true,
        priceLevel: '$$',
        cuisine: 'Italian',
        reservationUrl: 'https://opentable.com/da-enzo',
      },
      {
        title: 'Noma',
        url: 'https://maps.google.com/maps?cid=3',
        snippet: 'New Nordic',
        price: null,
        rating: 4.8,
        reviewCount: 2300,
        address: 'Refshalevej 96, Copenhagen',
        photoUrl: 'https://example.com/photo3.jpg',
        openNow: true,
        priceLevel: '$$$$',
        cuisine: 'Nordic',
        reservationUrl: 'https://exploretock.com/noma',
      },
    ];

    const output = formatTravelResults(results, 'en', false);
    expect(output).toMatchInlineSnapshot(`
      "🍽️ Found 3 restaurants:

      1. 🍽️ Osteria Francescana · Italian · $$$ · 🟢 · 4.9⭐ (1.2K) · https://opentable.com/osteria-francescana
      https://example.com/photo1.jpg
      2. 🍽️ Da Enzo al 29 · Italian · $$ · 🟢 · 4.7⭐ (845) · https://opentable.com/da-enzo
      https://example.com/photo2.jpg
      3. 🍽️ Noma · Nordic · $$$$ · 🟢 · 4.8⭐ (2.3K) · https://exploretock.com/noma
      https://example.com/photo3.jpg"
    `);
  });

  it('omits null segments cleanly (no · null ·, no double dots)', () => {
    const results: SearchResult[] = [
      {
        title: 'Trattoria Roma',
        url: 'https://maps.google.com/maps?cid=10',
        snippet: '',
        price: null,
        rating: 4.5,
        reviewCount: 300,
        address: 'Via Roma 5',
        // photoUrl intentionally null
        photoUrl: null,
        openNow: null,
        priceLevel: null,
        cuisine: null,
        reservationUrl: 'https://opentable.com/trattoria-roma',
      },
      {
        title: 'Sushi Bar Tokyo',
        url: 'https://maps.google.com/maps?cid=11',
        snippet: '',
        price: null,
        rating: 4.6,
        reviewCount: 512,
        address: 'Via Tokyo 1',
        photoUrl: 'https://example.com/sushi.jpg',
        openNow: null,
        priceLevel: '$$',
        cuisine: 'Sushi',
        reservationUrl: null,
      },
      {
        title: 'Pizza Napoli',
        url: 'https://maps.google.com/maps?cid=12',
        snippet: '',
        price: null,
        rating: null,
        reviewCount: null,
        address: null,
        photoUrl: null,
        openNow: true,
        priceLevel: null,
        cuisine: null,
        reservationUrl: null,
      },
    ];

    const output = formatTravelResults(results, 'en', false);
    // No "null" substring anywhere, no "·· " double dots
    expect(output).not.toContain('null');
    expect(output).not.toContain('··');
    expect(output).toMatchInlineSnapshot(`
      "🍽️ Found 3 restaurants:

      1. 🍽️ Trattoria Roma · 4.5⭐ (300) · https://opentable.com/trattoria-roma
      2. 🍽️ Sushi Bar Tokyo · Sushi · $$ · 4.6⭐ (512) · https://maps.google.com/maps?cid=11
      https://example.com/sushi.jpg
      3. 🍽️ Pizza Napoli · 🟢 · https://maps.google.com/maps?cid=12"
    `);
  });

  it('Hebrew fixture — header translated, cuisine/name pass-through', () => {
    const results: SearchResult[] = [
      {
        title: 'Trattoria Bella',
        url: 'https://maps.google.com/maps?cid=20',
        snippet: '',
        price: null,
        rating: 4.4,
        reviewCount: 210,
        address: 'Via Bella 3',
        photoUrl: null,
        openNow: true,
        priceLevel: '$$',
        cuisine: 'Italian',
        reservationUrl: 'https://opentable.com/trattoria-bella',
      },
      {
        title: 'Sushi Neko',
        url: 'https://maps.google.com/maps?cid=21',
        snippet: '',
        price: null,
        rating: 4.8,
        reviewCount: 680,
        address: 'Dizengoff 100, Tel Aviv',
        photoUrl: 'https://example.com/neko.jpg',
        openNow: false,
        priceLevel: '$$$',
        cuisine: 'Sushi',
        reservationUrl: null,
      },
    ];

    const output = formatTravelResults(results, 'he', false);
    // Header must be in Hebrew
    expect(output).toContain('נמצאו 2 מסעדות:');
    // Cuisine names stay in source language (not translated)
    expect(output).toContain('Italian');
    expect(output).toContain('Sushi');
    expect(output).toMatchInlineSnapshot(`
      "🍽️ נמצאו 2 מסעדות:

      1. 🍽️ Trattoria Bella · Italian · $$ · 🟢 · 4.4⭐ (210) · https://opentable.com/trattoria-bella
      2. 🍽️ Sushi Neko · Sushi · $$$ · 🔴 · 4.8⭐ (680) · https://maps.google.com/maps?cid=21
      https://example.com/neko.jpg"
    `);
  });

  it('open_now=false renders 🔴 and not 🟢', () => {
    const results: SearchResult[] = [
      {
        title: 'Late Night Diner',
        url: 'https://maps.google.com/maps?cid=30',
        snippet: '',
        price: null,
        rating: 4.1,
        reviewCount: 99,
        address: 'Main St 1',
        photoUrl: null,
        openNow: false,
        priceLevel: '$',
        cuisine: 'American',
        reservationUrl: null,
      },
    ];

    const output = formatTravelResults(results, 'en', false);
    expect(output).toContain('🔴');
    expect(output).not.toContain('🟢');
  });
});

// --- Suite 2: Regression — non-restaurant paths unchanged ---

describe('formatTravelResults — non-restaurant regression', () => {
  it('hotels golden snapshot (en) — formatOneLiner byte-identical to v1.4', () => {
    const results: SearchResult[] = [
      {
        title: 'Hotel Excelsior Florence',
        url: 'https://www.booking.com/hotel/it/excelsior-florence.html',
        snippet: 'Luxury hotel on the Arno',
        price: '$180',
        rating: 4.6,
        reviewCount: 1245,
        address: 'Piazza Ognissanti 3, Florence',
      },
      {
        title: 'Hotel de Russie Rome',
        url: 'https://www.booking.com/hotel/it/de-russie-rome.html',
        snippet: 'Elegant hotel near Piazza del Popolo',
        price: '$250',
        rating: 4.8,
        reviewCount: 876,
        address: 'Via del Babuino 9, Rome',
      },
    ];

    const output = formatTravelResults(results, 'en', false);
    expect(output).toMatchInlineSnapshot(`
      "🌍 Found 2 results:

      1. Hotel Excelsior Florence ⭐ 4.6 (1.2K) — Piazza Ognissanti 3, Florence — 🛒 https://www.booking.com/hotel/it/excelsior-florence.html
      2. Hotel de Russie Rome ⭐ 4.8 (876) — Via del Babuino 9, Rome — 🛒 https://www.booking.com/hotel/it/de-russie-rome.html"
    `);
  });

  it('hotels golden snapshot (he) — Hebrew header, formatOneLiner unchanged', () => {
    const results: SearchResult[] = [
      {
        title: 'Hotel Excelsior Florence',
        url: 'https://www.booking.com/hotel/it/excelsior-florence.html',
        snippet: 'Luxury hotel',
        price: '$180',
        rating: 4.6,
        reviewCount: 1245,
        address: 'Piazza Ognissanti 3, Florence',
      },
    ];

    const output = formatTravelResults(results, 'he', false);
    expect(output).toMatchInlineSnapshot(`
      "🌍 נמצאו 1 תוצאות:

      1. Hotel Excelsior Florence ⭐ 4.6 (1.2K) — Piazza Ognissanti 3, Florence — 🛒 https://www.booking.com/hotel/it/excelsior-florence.html"
    `);
  });

  it('empty results returns "No results found" (en)', () => {
    expect(formatTravelResults([], 'en', false)).toBe(
      'No results found. Try searching with different keywords.',
    );
  });

  it('empty results returns Hebrew string (he)', () => {
    expect(formatTravelResults([], 'he', false)).toBe(
      'לא נמצאו תוצאות. נסו לחפש עם מילות מפתח אחרות.',
    );
  });
});

// --- Suite 3: Edge cases ---

describe('formatTravelResults — edge cases', () => {
  it('URL priority: reservationUrl takes precedence over url', () => {
    const results: SearchResult[] = [
      {
        title: 'Best Bistro',
        url: 'https://maps.google.com/maps?cid=99',
        snippet: '',
        price: null,
        rating: 4.3,
        reviewCount: 150,
        address: null,
        photoUrl: null,
        openNow: true,
        priceLevel: '$$',
        cuisine: 'French',
        reservationUrl: 'https://opentable.com/best-bistro',
      },
    ];

    const output = formatTravelResults(results, 'en', false);
    // reservationUrl should appear; maps url should NOT
    expect(output).toContain('https://opentable.com/best-bistro');
    expect(output).not.toContain('https://maps.google.com');
  });

  it('result cap sanity: formatter renders all 7 results (cap lives in searchTravel, not formatter)', () => {
    const makeRestaurant = (i: number): SearchResult => ({
      title: `Restaurant ${i}`,
      url: `https://maps.google.com/maps?cid=${i}`,
      snippet: '',
      price: null,
      rating: 4.0,
      reviewCount: 100,
      address: null,
      photoUrl: null,
      openNow: null,
      priceLevel: null,
      cuisine: 'Italian',
      reservationUrl: null,
    });

    const results = Array.from({ length: 7 }, (_, i) => makeRestaurant(i + 1));
    const output = formatTravelResults(results, 'en', false);
    expect(output).toContain('Found 7 restaurants');
    // All 7 items rendered
    for (let i = 1; i <= 7; i++) {
      expect(output).toContain(`Restaurant ${i}`);
    }
  });

  it('isFallback=true appends fallback notice', () => {
    const results: SearchResult[] = [
      {
        title: 'Cafe Central',
        url: 'https://maps.google.com/maps?cid=50',
        snippet: '',
        price: null,
        rating: 4.2,
        reviewCount: 200,
        address: null,
        photoUrl: null,
        openNow: null,
        priceLevel: null,
        cuisine: 'Austrian',
        reservationUrl: null,
      },
    ];

    const output = formatTravelResults(results, 'en', true);
    expect(output).toContain('(based on general recommendations)');
  });
});
