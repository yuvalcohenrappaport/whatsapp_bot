/**
 * TripMap — Leaflet + OpenStreetMap map with category-iconed markers.
 *
 * Features:
 * - Custom divIcon markers using Lucide icon SVG per TripCategory
 * - fitBounds on initial load and whenever filteredOrigins changes
 * - Marker click: popup with title/category/note + "Show on board" action
 * - Off-map badge: "N decisions not on map" for decisions missing lat/lng
 * - Leaflet CSS imported via dashboard/src/index.css (@import 'leaflet/dist/leaflet.css')
 *
 * NOTE: react-leaflet MapContainer requires a defined height or tiles won't render.
 */
import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TripDecision, DecisionOrigin, TripCategory } from '@/api/tripSchemas';
import { categoryIcons, categoryColors, categoryLabels } from './categoryIcons';

interface TripMapProps {
  /** Active decisions only (status='active') — deleted rows already filtered out by TripView */
  decisions: TripDecision[];
  filteredOrigins: Set<DecisionOrigin>;
  onMarkerClick: (decisionId: string) => void;
}

// ─── Custom divIcon helper ────────────────────────────────────────────────────

function makeCategoryIcon(category: TripCategory | null): L.DivIcon {
  const Icon = categoryIcons[category ?? 'other'];
  const colorClass = categoryColors[category ?? 'other'];
  // renderToStaticMarkup produces a plain HTML string for the Leaflet divIcon
  const html = renderToStaticMarkup(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        background: 'white',
        border: '2px solid #334155',
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      }}
      className={colorClass}
    >
      {/* Inline SVG rendered via renderToStaticMarkup */}
      <Icon size={18} />
    </div>,
  );
  return L.divIcon({
    html,
    className: '', // disable Leaflet's default leaflet-div-icon styles
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

// ─── FitBoundsOnChange child component ────────────────────────────────────────

interface FitBoundsProps {
  positions: [number, number][];
}

function FitBoundsOnChange({ positions }: FitBoundsProps) {
  const map = useMap();
  const prevKey = useRef<string>('');

  useEffect(() => {
    const key = positions.map((p) => p.join(',')).join('|');
    if (key === prevKey.current) return;
    prevKey.current = key;

    if (positions.length === 0) {
      map.setView([20, 0], 2);
      return;
    }
    if (positions.length === 1) {
      map.setView(positions[0], 13);
      return;
    }
    const bounds = L.latLngBounds(positions.map((p) => L.latLng(p[0], p[1])));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, positions]);

  return null;
}

// ─── Short note extractor from metadata JSON string ──────────────────────────

function extractNote(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const note = parsed['notes'] ?? parsed['address'] ?? parsed['note'];
    if (typeof note === 'string' && note.trim()) {
      return note.length > 120 ? note.slice(0, 120) + '…' : note;
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TripMap({ decisions, filteredOrigins, onMarkerClick }: TripMapProps) {
  // Apply origin filter (map only shows visible + has coordinates)
  const visibleDecisions = decisions.filter(
    (d) => d.lat != null && d.lng != null && filteredOrigins.has(d.origin),
  );

  const offMapCount = decisions.filter(
    (d) => (d.lat == null || d.lng == null) && filteredOrigins.has(d.origin),
  ).length;

  const positions: [number, number][] = visibleDecisions
    .filter((d) => d.lat != null && d.lng != null)
    .map((d) => [d.lat!, d.lng!]);

  return (
    <section id="trip-map" className="space-y-3">
      <h2 className="text-lg font-semibold">Map</h2>

      <div className="relative h-[400px] rounded-lg overflow-hidden border">
        <MapContainer
          center={[20, 0]}
          zoom={2}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitBoundsOnChange positions={positions} />

          {visibleDecisions.map((d) => {
            if (d.lat == null || d.lng == null) return null;
            const icon = makeCategoryIcon(d.category);
            const note = extractNote(d.metadata);
            const categoryLabel = d.category ? categoryLabels[d.category] : 'Other';

            return (
              <Marker key={d.id} position={[d.lat, d.lng]} icon={icon}>
                <Popup>
                  <div className="text-sm space-y-1 min-w-[160px]">
                    <p className="font-semibold leading-snug">{d.value}</p>
                    <p className="text-muted-foreground text-xs">{categoryLabel}</p>
                    {note && <p className="text-xs text-muted-foreground">{note}</p>}
                    <button
                      className="mt-2 text-xs text-primary underline underline-offset-2 hover:no-underline"
                      onClick={() => onMarkerClick(d.id)}
                    >
                      Show on board
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* Off-map badge */}
        {offMapCount > 0 && (
          <div
            className="absolute bottom-3 left-3 z-[1000] bg-background/90 border rounded-md px-2 py-1 text-xs text-muted-foreground pointer-events-none"
          >
            {offMapCount} decision{offMapCount !== 1 ? 's' : ''} not on map
          </div>
        )}
      </div>
    </section>
  );
}
