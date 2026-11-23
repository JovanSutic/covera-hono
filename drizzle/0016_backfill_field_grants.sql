INSERT INTO "special_access" (
  "access_id", "scope", "apartment_id", "reservation_id", "incident_item_id", "expires_at", "created_at"
)
SELECT
  ii."cleaner_token",
  'damage_evidence',
  r."apartment_id",
  r."id",
  ii."id",
  ii."token_expires_at",
  now()
FROM "incident_items" ii
JOIN "incidents" i ON i."id" = ii."incident_id"
JOIN "reservations" r ON r."id" = i."reservation_id"
WHERE ii."token_expires_at" > now()
  AND NOT EXISTS (
    SELECT 1 FROM "special_access" sa WHERE sa."access_id" = ii."cleaner_token"
  );
