/**
 * categoryIcons — single source of truth for icon glyph + accent color + label
 * per TripCategory. Reused by TripMap markers, DecisionsBoard accordion headers,
 * and BudgetBar rows.
 */
import {
  Plane,
  Hotel,
  Utensils,
  Mountain,
  Train,
  ShoppingBag,
  Compass,
  type LucideIcon,
} from 'lucide-react';
import type { TripCategory } from '@/api/tripSchemas';

export const TRIP_CATEGORIES: TripCategory[] = [
  'flights',
  'lodging',
  'food',
  'activities',
  'transit',
  'shopping',
  'other',
];

export const categoryIcons: Record<TripCategory, LucideIcon> = {
  flights: Plane,
  lodging: Hotel,
  food: Utensils,
  activities: Mountain,
  transit: Train,
  shopping: ShoppingBag,
  other: Compass,
};

export const categoryColors: Record<TripCategory, string> = {
  flights: 'text-sky-500',
  lodging: 'text-emerald-500',
  food: 'text-amber-500',
  activities: 'text-violet-500',
  transit: 'text-orange-500',
  shopping: 'text-rose-500',
  other: 'text-slate-500',
};

export const categoryBgColors: Record<TripCategory, string> = {
  flights: 'bg-sky-500',
  lodging: 'bg-emerald-500',
  food: 'bg-amber-500',
  activities: 'bg-violet-500',
  transit: 'bg-orange-500',
  shopping: 'bg-rose-500',
  other: 'bg-slate-500',
};

export const categoryLabels: Record<TripCategory, string> = {
  flights: 'Flights',
  lodging: 'Lodging',
  food: 'Food',
  activities: 'Activities',
  transit: 'Transit',
  shopping: 'Shopping',
  other: 'Other',
};
