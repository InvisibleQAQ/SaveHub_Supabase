# Feed Failure Handling

## Overview

This document explains how the RSS Reader handles failed feed refreshes to prevent log spam and provide user visibility into feed health.

## Problem Solved

**Before**: When an RSS feed URL became invalid, the system would:
- Retry immediately and continuously
- Fill logs with error messages
- Not update `last_fetched` timestamp
- Give no UI indication of the problem

**After**: When a feed refresh fails:
- Updates `last_fetched` to prevent retry storms
- Stores failure status and error message in database
- Shows visual indicator in sidebar
- Retries at next scheduled interval (respects `refresh_interval`)

## Architecture

### Database Schema

```sql
-- Added in scripts/002_add_feed_status_tracking.sql
ALTER TABLE feeds
ADD COLUMN last_fetch_status TEXT CHECK (last_fetch_status IN ('success', 'failed')),
ADD COLUMN last_fetch_error TEXT;
```

### Data Flow

```
1. Scheduled refresh triggers
   ↓
2. refreshFeed() attempts to parse RSS
   ↓
3a. SUCCESS:                    3b. FAILURE:
    - Add articles to store         - No articles added
    - Update lastFetchStatus='success'  - Update lastFetchStatus='failed'
    - Clear lastFetchError          - Store lastFetchError
    - Update lastFetched=NOW        - Update lastFetched=NOW ← KEY
    ↓                               ↓
4. Calculate next refresh: lastFetched + refreshInterval
   (Both branches use same logic - no special retry behavior)
   ↓
5. Schedule next refresh at calculated time
```

### Key Design Decisions

**1. Failure is a valid completion state**
- `refreshFeed()` returns `{success, error}` instead of throwing
- Both success and failure update `lastFetched` timestamp
- Scheduler treats both cases uniformly

**2. No retry storms**
```typescript
// BAD (old code):
catch (error) {
  // Don't update last_fetched → immediate retry → log spam
  throw error
}

// GOOD (new code):
catch (error) {
  updateFeed(feedId, {
    lastFetched: new Date(),  // ← Prevents immediate retry
    lastFetchStatus: 'failed',
    lastFetchError: errorMsg
  })
  return { success: false, error: errorMsg }
}
```

**3. UI visibility**
- Collapsed sidebar: Red badge on RSS icon
- Expanded sidebar: AlertCircle icon next to feed title
- Tooltip shows error message on hover

## Testing

### Setup Test Environment

1. **Run database migration**:
   ```sql
   -- In Supabase SQL Editor, run:
   -- scripts/002_add_feed_status_tracking.sql
   ```

2. **Start development server**:
   ```bash
   pnpm dev
   ```

### Test Case 1: Add Invalid RSS URL

1. Click "Add Feed" in sidebar
2. Enter an invalid URL (e.g., `https://example.com/nonexistent.xml`)
3. Click "Add Feed"
4. **Expected behavior**:
   - Feed added to sidebar
   - Automatic refresh starts
   - After ~5 seconds, red AlertCircle appears next to feed name
   - Hover over icon shows error: "Failed to fetch feed"
   - No continuous retries in console logs

### Test Case 2: Valid Feed Goes Invalid

1. Add a valid feed (e.g., BBC News RSS)
2. Wait for successful refresh (green status)
3. Edit feed properties → Change URL to broken URL
4. Wait for next scheduled refresh
5. **Expected behavior**:
   - Status changes from 'success' to 'failed'
   - Red warning icon appears
   - Tooltip shows specific error message
   - Next refresh scheduled at normal interval (not immediate)

### Test Case 3: Recover from Failure

1. Create a feed with broken URL (failed status)
2. Edit feed properties → Fix the URL
3. Force refresh (or wait for scheduled refresh)
4. **Expected behavior**:
   - Status changes from 'failed' to 'success'
   - Red warning icon disappears
   - Error message cleared
   - Articles appear

### Test Case 4: Collapsed Sidebar

1. Collapse sidebar (click collapse button)
2. Observe feed icons
3. **Expected behavior**:
   - Failed feeds show small red badge on RSS icon
   - Hover shows tooltip with feed name + error message
   - Success feeds have no badge

## Monitoring

### Check Feed Status Programmatically

```typescript
import { useRSSStore } from '@/lib/store'

const feeds = useRSSStore.getState().feeds

// Find all failed feeds
const failedFeeds = feeds.filter(f => f.lastFetchStatus === 'failed')

failedFeeds.forEach(feed => {
  console.log(`Failed feed: ${feed.title}`)
  console.log(`Error: ${feed.lastFetchError}`)
  console.log(`Last attempted: ${feed.lastFetched}`)
})
```

### Database Query

```sql
-- Find all failed feeds
SELECT
  title,
  url,
  last_fetch_status,
  last_fetch_error,
  last_fetched
FROM feeds
WHERE last_fetch_status = 'failed';
```

## Known Limitations

1. **No retry backoff**: Failed feeds retry at same interval as successful ones
   - **Improvement**: Could implement exponential backoff (60min → 120min → 240min)
2. **Error messages not i18n**: Error text is in English only
3. **No success→failure notification**: User only sees indicator, no toast/notification

## Implementation Files

- `scripts/002_add_feed_status_tracking.sql` - Database schema
- `lib/types.ts` - Added `lastFetchStatus` + `lastFetchError` to Feed type
- `lib/db/feeds.ts` - Handle new fields in CRUD operations
- `lib/scheduler.ts` - Modified `refreshFeed()` to never throw
- `components/sidebar/feed-item.tsx` - Visual indicator UI

## Related Documentation

- [Architecture Guide](./02-architecture.md) - Overall system design
- [Data Flow Guide](./04-data-flow.md) - How data moves through the system
- [Common Tasks](./06-common-tasks.md) - Code examples for basic features
