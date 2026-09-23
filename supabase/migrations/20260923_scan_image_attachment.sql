-- Bounded image evidence follows the existing scan access policies.
-- No storage bucket or public media URL is created. Apply before the API update.
BEGIN;
ALTER TABLE public.compliance_scans ADD COLUMN IF NOT EXISTS image_attachment jsonb;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eyeonads_scan_image_attachment_bounded' AND conrelid = 'public.compliance_scans'::regclass) THEN
ALTER TABLE public.compliance_scans ADD CONSTRAINT eyeonads_scan_image_attachment_bounded CHECK (
  image_attachment IS NULL OR (
    jsonb_typeof(image_attachment) = 'object'
    AND octet_length(image_attachment::text) <= 2010000
    AND coalesce(length(image_attachment->>'filename') BETWEEN 1 AND 200, false)
    AND coalesce(length(image_attachment->>'data_url') <= 2000000, false)
    AND coalesce((image_attachment->>'data_url') ~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$', false)
    AND coalesce((image_attachment->>'sha256') ~ '^[a-f0-9]{64}$', false)
    AND coalesce((image_attachment->>'review_status') IN ('reviewed','partial','unavailable','not_requested'), false)
  )
);
END IF;
END $$;
COMMENT ON COLUMN public.compliance_scans.image_attachment IS 'Uploaded image evidence, capped at 2MB encoded per scan; accessed under existing scan RLS policies.';
NOTIFY pgrst, 'reload schema';
COMMIT;
