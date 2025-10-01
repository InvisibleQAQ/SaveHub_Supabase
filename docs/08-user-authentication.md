# User Authentication & Multi-tenancy Implementation

**Status**: ✅ Implemented
**Date**: 2025-10-01
**Migration**: `scripts/002_add_user_authentication.sql`

---

## TL;DR for Future LLMs

**What was done**:
- Migrated from single-user to multi-tenant architecture
- All tables now have `user_id` foreign key to `auth.users`
- Row-Level Security (RLS) enforces data isolation automatically
- Supabase Auth handles authentication with email/password
- Database trigger auto-creates default settings for new users

**Key principle**: **RLS does the filtering, code stays clean.**

---

## 1. Database Schema Changes

### Migration SQL: `scripts/002_add_user_authentication.sql`

**What changed**:

1. **Settings table**: Migrated from singleton (`id: 'app-settings'`) to per-user (`user_id: UUID`)
   ```sql
   ALTER TABLE settings DROP COLUMN id;
   ALTER TABLE settings ADD COLUMN user_id UUID PRIMARY KEY;
   ALTER TABLE settings ADD FOREIGN KEY (user_id) REFERENCES auth.users(id);
   ```

2. **All tables got `user_id`**:
   ```sql
   ALTER TABLE folders ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
   ALTER TABLE feeds ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
   ALTER TABLE articles ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);
   ```

3. **Row-Level Security enabled**:
   ```sql
   ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
   ALTER TABLE feeds ENABLE ROW LEVEL SECURITY;
   ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
   ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

   CREATE POLICY folders_user_isolation ON folders
     FOR ALL USING (auth.uid() = user_id);
   -- (同样的policy应用到所有表)
   ```

4. **Auto-create settings trigger**:
   ```sql
   CREATE FUNCTION create_default_user_settings() RETURNS TRIGGER AS $$
   BEGIN
     INSERT INTO settings (user_id, theme, font_size, ...)
     VALUES (NEW.id, 'system', 16, ...);
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER on_auth_user_created
     AFTER INSERT ON auth.users
     EXECUTE FUNCTION create_default_user_settings();
   ```

**Result**: Postgres自动过滤查询,只返回当前用户的数据。代码无需改动查询逻辑。

---

## 2. Code Changes

### 2.1 Authentication Flow

#### **New file**: `app/login/page.tsx`
- Uses `@supabase/auth-ui-react` for pre-built login/signup UI
- Listens to `onAuthStateChange` → redirects to `/all` on login
- Zero custom auth logic needed

```typescript
<Auth
  supabaseClient={supabase}
  appearance={{ theme: ThemeSupa }}
  redirectTo={`${window.location.origin}/all`}
/>
```

#### **Modified**: `app/(reader)/layout.tsx`
- Checks auth status before rendering
- Redirects to `/login` if no session
- Listens to auth state changes (logout → redirect)

```typescript
useEffect(() => {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    router.push('/login')
  }
}, [])
```

**Critical**: Auth check happens **before** database check. Order matters.

---

### 2.2 Database Layer: `lib/db.ts`

**Pattern**: All insert/upsert operations now inject `user_id` automatically.

#### **Modified**: Transform functions signature
```typescript
// Before
function feedToDb(feed: Feed): DbRow { ... }

// After
function feedToDb(feed: Feed, userId: string): DbRow {
  return {
    ...feed,
    user_id: userId  // Add this
  }
}
```

#### **Modified**: GenericRepository.save()
```typescript
async save(items: TApp[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const dbItems = items.map(item => this.toDb(item, user.id))
  await supabase.from(this.tableName).upsert(dbItems)
}
```

#### **Modified**: Settings operations
```typescript
// loadSettings() now queries by user_id
const { data } = await supabase
  .from("settings")
  .select("*")
  .eq("user_id", user.id)  // Changed from .eq("id", "app-settings")
  .single()
```

#### **Modified**: `isDatabaseInitialized()`
- Checks if `folders.user_id` column exists
- Treats RLS errors as "database initialized" (not missing table)

```typescript
async isDatabaseInitialized(): Promise<boolean> {
  const { error } = await supabase.from("folders").select("user_id").limit(0)

  // RLS error = table exists, just no permission (OK)
  if (error.code === "PGRST301") return true

  // Column/table not exist = migration not run
  if (error.code === "42703" || error.code === "42P01") return false

  return !error
}
```

**Key insight**: RLS makes queries fail when unauthenticated, but table still exists. Don't confuse "access denied" with "table missing".

---

### 2.3 UI: Logout Buttons

#### **Modified**: `components/sidebar/expanded-view.tsx`
- Added "Logout" button in footer (below Settings)
- Calls `supabase.auth.signOut()` → `router.push('/login')`

#### **Modified**: `components/sidebar/collapsed-view.tsx`
- Added LogOut icon button (below Settings icon)
- Same signOut logic with stopPropagation to prevent sidebar expansion

```typescript
const handleLogout = async () => {
  await supabase.auth.signOut()
  router.push('/login')
}
```

---

## 3. Key Implementation Details

### 3.1 Why RLS = Zero Manual Filtering

**Before multi-tenancy**:
```typescript
// Would need this everywhere:
const feeds = await supabase
  .from("feeds")
  .select("*")
  .eq("user_id", currentUser.id)  // Manual filter
```

**With RLS enabled**:
```typescript
// This automatically filters by user_id:
const feeds = await supabase.from("feeds").select("*")
```

Postgres applies `WHERE user_id = auth.uid()` to every query. Code stays clean.

### 3.2 Trigger = Auto Settings

**Problem**: New users need default settings, but we can't manually insert because we don't control Supabase Auth's user creation.

**Solution**: Database trigger on `auth.users` table:
```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_default_user_settings();
```

When Supabase creates a user → trigger fires → settings row created automatically.

### 3.3 Auth Check Order Matters

**Correct order in `(reader)/layout.tsx`**:
1. Check auth → redirect if not logged in
2. Check database initialized → show setup UI if not
3. Load data → populate store

**Why**: If you check database before auth, RLS errors get confused with missing tables.

---

## 4. Testing Checklist

Run these tests to verify the implementation:

### ✅ Basic Auth Flow
1. Visit http://localhost:3005 → redirects to `/login`
2. Sign up with email + password
3. Check Supabase Dashboard → new user in `auth.users`
4. Check `settings` table → new row with `user_id` matching new user
5. Redirects to `/all` after signup

### ✅ Data Isolation
1. User A: Login → Add 2 feeds → Add 1 folder
2. User A: Logout
3. User B: Login → Should see **zero feeds/folders**
4. User B: Add different feeds
5. User A: Login again → Should see **only their own 2 feeds**

### ✅ RLS Protection
1. In Supabase SQL Editor, run:
   ```sql
   SELECT * FROM feeds;  -- Should return ZERO rows (no auth context)
   ```
2. In browser console:
   ```javascript
   // Try to query all users' feeds
   const { data } = await supabase.from('feeds').select('*')
   console.log(data)  // Should only show current user's feeds
   ```

### ✅ Logout
1. Click "Logout" button in sidebar
2. Redirects to `/login`
3. Try visiting `/all` → redirects back to `/login`

---

## 5. File Changes Summary

### New Files
- `app/login/page.tsx` - Auth UI page
- `scripts/002_add_user_authentication.sql` - Migration script
- `docs/08-user-authentication.md` - This document

### Modified Files
- `app/(reader)/layout.tsx` - Auth guard
- `lib/db.ts` - User ID injection in all operations
- `components/sidebar/expanded-view.tsx` - Logout button
- `components/sidebar/collapsed-view.tsx` - Logout icon
- `package.json` - Added `@supabase/auth-ui-react`, `@supabase/auth-ui-shared`

### Database Tables Modified
- `settings` - Changed PK from `id` to `user_id`
- `folders` - Added `user_id` column + RLS
- `feeds` - Added `user_id` column + RLS
- `articles` - Added `user_id` column + RLS

---

## 6. Architecture Decisions

### Why Supabase Auth (not custom)?
- **Zero code**: Email verification, password reset, session management all handled
- **Security**: Hardened by Supabase team, not DIY
- **RLS integration**: `auth.uid()` works natively in policies

### Why RLS (not app-level filtering)?
- **Defense in depth**: Even if app code has bug, DB enforces isolation
- **Cleaner code**: No `.eq("user_id", ...)` littering every query
- **Performance**: Postgres indexes + query planner optimized for RLS

### Why trigger for settings?
- **Atomic**: Settings created in same transaction as user
- **No race condition**: Can't have user without settings
- **No app dependency**: Works even if app crashes during signup

---

## 7. Troubleshooting

### "Database Setup Required" after migration
**Cause**: `isDatabaseInitialized()` seeing RLS error as "table missing"
**Fix**: Updated logic to treat RLS errors (PGRST301) as success

### Can't load feeds after adding auth
**Cause**: `toDb` functions missing `user_id` parameter
**Fix**: All transform functions now take `userId: string` parameter

### Settings not created for new user
**Cause**: Trigger not attached or function missing
**Fix**: Verify trigger exists:
```sql
SELECT trigger_name FROM information_schema.triggers
WHERE event_object_table = 'users';
```

### Existing data disappeared
**Cause**: Old data has `user_id = NULL`, RLS filters it out
**Fix**: Either assign to a user or delete:
```sql
-- Assign to first user
UPDATE feeds SET user_id = (SELECT id FROM auth.users LIMIT 1);
-- Or delete
DELETE FROM feeds WHERE user_id IS NULL;
```

---

## 8. Future Considerations

### Adding OAuth providers
Edit `app/login/page.tsx`:
```typescript
<Auth
  supabaseClient={supabase}
  providers={['google', 'github']}  // Add this
/>
```

### User profile/settings sync
Settings table already exists. Add columns as needed:
```sql
ALTER TABLE settings ADD COLUMN display_name TEXT;
```

### Team/shared feeds (future)
Would need:
- `teams` table
- `team_members` junction table
- RLS policies: `user_id = auth.uid() OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())`

---

## 9. References

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Row Level Security Guide](https://supabase.com/docs/guides/auth/row-level-security)
- [Auth UI React](https://github.com/supabase/auth-ui)
- Migration SQL: `scripts/002_add_user_authentication.sql`

---

**Summary for LLMs**: This codebase uses Supabase Auth + RLS for multi-tenancy. All queries are auto-filtered by `user_id`. Don't manually add user filters to queries - RLS handles it. New users get settings via database trigger. Auth check happens in layout before data load.
