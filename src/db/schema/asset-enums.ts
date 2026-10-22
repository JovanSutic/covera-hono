import { pgEnum } from 'drizzle-orm/pg-core';

export const photoProofRequirementEnum = pgEnum('photo_proof_requirement', [
  'SWEEP_ONLY',
  'CLOSEUP',
  'FUNCTIONAL_ACTION'
]);

export const assetCategoryEnum = pgEnum('asset_category', [
  'ELECTRONICS',
  'APPLIANCES_LARGE',
  'APPLIANCES_SMALL',
  'FURNITURE',
  'STRUCTURAL_SURFACES',
  'BATH_PLUMBING_FIXTURES',
  'RUGS_CARPETS_TEXTILES',
  'LIGHTING_FIXTURES',
  'SAFETY_SECURITY',
  'ENTERTAINMENT_RECREATION',
  'DECOR_ART',
  'UTILITIES_INFRASTRUCTURE',
  'OUTDOOR_PATIO',
  'OTHER'
]);

export const roomLocationEnum = pgEnum('room_location', [
  'ENTRANCE_HALLWAY',
  'STAIRCASE_CORRIDOR',
  'LIVING_ROOM',
  'DINING_ROOM',
  'GAME_ENTERTAINMENT_ROOM',
  'HOME_OFFICE_STUDY',
  'KITCHEN',
  'PANTRY_LAUNDRY_ROOM',
  'BEDROOM_PRIMARY',
  'BEDROOM_2',
  'BEDROOM_3',
  'BEDROOM_4',
  'BEDROOM_5',
  'BATHROOM_FULL_1',
  'BATHROOM_FULL_2',
  'BATHROOM_FULL_3',
  'BATHROOM_HALF_POWDER',
  'SAUNA_SPA_ROOM',
  'GYM_FITNESS_ROOM',
  'BALCONY_TERRACE',
  'PATIO_DECK',
  'GARDEN_YARD',
  'SWIMMING_POOL_AREA',
  'STORAGE_ROOM',
  'GARAGE_PARKING',
  'UTILITY_BOILER_ROOM',
  'OTHER'
]);

export const assetAgeBracketEnum = pgEnum('asset_age_bracket', [
  'UNDER_1_YEAR',
  'ONE_TO_THREE_YEARS',
  'THREE_TO_FIVE_YEARS',
  'OVER_FIVE_YEARS'
]);

export const assetValueTierEnum = pgEnum('asset_value_tier', [
  'BUDGET',
  'STANDARD',
  'PREMIUM',
  'LUXURY'
]);