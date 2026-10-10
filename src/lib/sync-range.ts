import { z } from "zod";

/** Unix-second window chosen in the browser (local midnight etc.); `before` omitted = until now. */
export const SyncRangeSchema = z
  .object({
    after: z.coerce.number().int().min(0),
    before: z.coerce.number().int().min(0).optional(),
  })
  .refine((r) => r.before === undefined || r.before > r.after, "Range end must be after its start.")
  .refine((r) => r.after <= Date.now() / 1000, "Range can’t start in the future.");
