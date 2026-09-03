// Single BullMQ queue — no per-canal/per-evento queues yet. Splitting by
// canal (if ever needed, e.g. to isolate a slow/rate-limited provider) is a
// decision for whichever phase actually needs it.
export const NOTIFICACIONES_QUEUE = 'notificaciones';
