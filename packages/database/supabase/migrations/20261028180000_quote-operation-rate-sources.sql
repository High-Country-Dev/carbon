-- Where a quote operation's rates came from, and when a work center's rates
-- last changed. A quote shows next to each labor, machine and overhead rate
-- whether it came from the work center, the process's average or was typed on
-- the quote, who set it and when, and flags a rate that no longer matches the
-- work center.

-- Work centers: when the rates last changed (any other edit leaves it).
ALTER TABLE "workCenter"
  ADD COLUMN "ratesUpdatedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "ratesUpdatedBy" TEXT REFERENCES "user" ("id") ON DELETE SET NULL;

UPDATE "workCenter"
SET
  "ratesUpdatedAt" = COALESCE("updatedAt", "createdAt"),
  "ratesUpdatedBy" = COALESCE("updatedBy", "createdBy");

CREATE OR REPLACE FUNCTION "stamp_work_center_rates_updated"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR NEW."laborRate" IS DISTINCT FROM OLD."laborRate"
    OR NEW."machineRate" IS DISTINCT FROM OLD."machineRate"
    OR NEW."overheadRate" IS DISTINCT FROM OLD."overheadRate"
  THEN
    NEW."ratesUpdatedAt" := now();
    NEW."ratesUpdatedBy" := COALESCE(NEW."updatedBy", NEW."createdBy");
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "workCenter_rates_updated"
  BEFORE INSERT OR UPDATE ON "workCenter"
  FOR EACH ROW EXECUTE FUNCTION "stamp_work_center_rates_updated"();

-- Quote operations: one entry per rate,
--   { "laborRate": { "source": "Work Center", "at": "...", "by": "<user id>" }, ... }
-- source is "Work Center", "Process Average", "Manual" or "Imported". Rows
-- from before this migration have no entry until a rate is next saved.
ALTER TABLE "quoteOperation"
  ADD COLUMN "rateSources" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Worked out when the row is written, so every path that writes an operation
-- (the bill of process form, the API, copying a method or a quote) records it.
-- A rate equal to the work center's is "Work Center"; with no work center, a
-- rate equal to the average of the process's active work centers (what the
-- form fills in) is "Process Average"; anything else is "Manual". A writer can
-- name the source itself on insert (a data load says "Imported").
CREATE OR REPLACE FUNCTION "stamp_quote_operation_rate_sources"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_rate TEXT;
  v_value NUMERIC;
  v_old NUMERIC;
  v_reference NUMERIC;
  v_source TEXT;
  v_work_center "workCenter"%ROWTYPE;
  v_has_work_center BOOLEAN := FALSE;
  v_average_labor NUMERIC;
  v_average_machine NUMERIC;
  v_average_overhead NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW."laborRate" IS NOT DISTINCT FROM OLD."laborRate"
    AND NEW."machineRate" IS NOT DISTINCT FROM OLD."machineRate"
    AND NEW."overheadRate" IS NOT DISTINCT FROM OLD."overheadRate"
    AND NEW."workCenterId" IS NOT DISTINCT FROM OLD."workCenterId"
  THEN
    RETURN NEW;
  END IF;

  IF NEW."workCenterId" IS NOT NULL THEN
    SELECT * INTO v_work_center FROM "workCenter" WHERE "id" = NEW."workCenterId";
    v_has_work_center := FOUND;
  ELSIF NEW."processId" IS NOT NULL THEN
    SELECT avg(wc."laborRate"), avg(wc."machineRate"), avg(wc."overheadRate")
    INTO v_average_labor, v_average_machine, v_average_overhead
    FROM "workCenterProcess" wcp
    JOIN "workCenter" wc ON wc."id" = wcp."workCenterId"
    WHERE wcp."processId" = NEW."processId" AND wc."active" = TRUE;
  END IF;

  FOREACH v_rate IN ARRAY ARRAY['laborRate', 'machineRate', 'overheadRate'] LOOP
    v_value := (to_jsonb(NEW) ->> v_rate)::NUMERIC;
    v_old := CASE WHEN TG_OP = 'UPDATE' THEN (to_jsonb(OLD) ->> v_rate)::NUMERIC END;

    CONTINUE WHEN TG_OP = 'UPDATE'
      AND v_value IS NOT DISTINCT FROM v_old
      AND NEW."workCenterId" IS NOT DISTINCT FROM OLD."workCenterId";
    -- A source the writer named on insert stands.
    CONTINUE WHEN TG_OP = 'INSERT' AND NEW."rateSources" ? v_rate;

    IF v_has_work_center THEN
      v_reference := (to_jsonb(v_work_center) ->> v_rate)::NUMERIC;
      v_source := CASE
        WHEN abs(COALESCE(v_value, 0) - COALESCE(v_reference, 0)) < 0.005 THEN 'Work Center'
        ELSE 'Manual'
      END;
    ELSE
      v_reference := CASE v_rate
        WHEN 'laborRate' THEN v_average_labor
        WHEN 'machineRate' THEN v_average_machine
        ELSE v_average_overhead
      END;
      v_source := CASE
        WHEN v_reference IS NOT NULL
          AND abs(COALESCE(v_value, 0) - v_reference) < 0.005 THEN 'Process Average'
        ELSE 'Manual'
      END;
    END IF;

    NEW."rateSources" := COALESCE(NEW."rateSources", '{}'::jsonb) || jsonb_build_object(
      v_rate,
      jsonb_build_object(
        'source', v_source,
        'at', now(),
        'by', COALESCE(NEW."updatedBy", NEW."createdBy")
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "quoteOperation_rate_sources"
  BEFORE INSERT OR UPDATE ON "quoteOperation"
  FOR EACH ROW EXECUTE FUNCTION "stamp_quote_operation_rate_sources"();
