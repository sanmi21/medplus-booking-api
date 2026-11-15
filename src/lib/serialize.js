// Turns database rows into the exact JSON shapes in the spec.
// Keeping this in one place means field names can't drift between endpoints.

export function slotToJson(row) {
  const slot = {
    id: row.id,
    provider: row.provider,
    // Echo back exactly what /reset received, so the checks see their own strings.
    start: row.start_raw,
    end: row.end_raw,
  };
  if (row.available !== undefined) {
    slot.available = row.available;
  }
  return slot;
}

export function bookingToJson(row) {
  return {
    id: row.id,
    slot_id: row.slot_id,
    name: row.name,
    email: row.email,
    status: row.status,
    created_at: row.created_at.toISOString(), // always UTC, e.g. 2026-12-10T09:00:00.000Z
  };
}
