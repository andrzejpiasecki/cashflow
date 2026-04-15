-- Move application data to one shared (global) scope across all users.

-- 1) Flow rows: make all rows global.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'FlowRow'
      AND column_name = 'userId'
  ) THEN
    UPDATE "FlowRow"
    SET "userId" = 'global'
    WHERE "userId" <> 'global';
  END IF;
END $$;

-- 2) Transactions (if used): make all rows global as well.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Transaction'
      AND column_name = 'userId'
  ) THEN
    UPDATE "Transaction"
    SET "userId" = 'global'
    WHERE "userId" <> 'global';
  END IF;
END $$;

-- 3) Fitssey settings: keep one latest row and assign it to global scope.
DO $$
DECLARE
  keep_id TEXT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'FitsseySettings'
  ) THEN
    SELECT fs."id"
    INTO keep_id
    FROM "FitsseySettings" fs
    ORDER BY
      CASE WHEN fs."userId" = 'global' THEN 1 ELSE 0 END DESC,
      fs."updatedAt" DESC,
      fs."createdAt" DESC
    LIMIT 1;

    IF keep_id IS NOT NULL THEN
      -- Avoid unique conflict on FitsseySettings.userId before switching keeper to "global".
      DELETE FROM "FitsseySettings"
      WHERE "id" <> keep_id
        AND "userId" = 'global';

      UPDATE "FitsseySettings"
      SET "userId" = 'global'
      WHERE "id" = keep_id;

      DELETE FROM "FitsseySettings"
      WHERE "id" <> keep_id;
    END IF;
  END IF;
END $$;
