
# Real-time Synchronization

<details>
<summary>Relevant source files</summary>

The following files were used as context for generating this wiki page:

- [CLAUDE.md](CLAUDE.md)
- [backend/app/api/routers/websocket.py](backend/app/api/routers/websocket.py)
- [backend/app/main.py](backend/app/main.py)
- [frontend/hooks/use-realtime-sync.ts](frontend/hooks/use-realtime-sync.ts)
- [frontend/lib/api-validation.ts](frontend/lib/api-validation.ts)
- [frontend/lib/api/api-configs.ts](frontend/lib/api/api-configs.ts)
- [frontend/lib/api/articles.ts](frontend/lib/api/articles.ts)
- [frontend/lib/api/feeds.ts](frontend/lib/api/feeds.ts)
- [frontend/lib/api/fetch-client.ts](frontend/lib/api/fetch-client.ts)
- [frontend/lib/api/folders.ts](frontend/lib/api/folders.ts)
- [frontend/lib/api/github.ts](frontend/lib/api/github.ts)
- [frontend/lib/api/settings.ts](frontend/lib/api/settings.ts)
- [frontend/lib/context/auth-context.tsx](frontend/lib/context/auth-context.tsx)

</details>



## Purpose

This document explains SaveHub's real-time synchronization architecture, which enables multi-client consistency by propagating database changes to all connected clients via WebSocket. The system uses a three-layer architecture: Postgres NOTIFY triggers, a backend realtime forwarder service, and frontend WebSocket subscriptions that update Zustand store state.

For HTTP API operations and request/response patterns, see [Backend Services](#5). For frontend state management patterns, see [State Management](#4.1). For authentication mechanisms, see [Authentication & Security](#3.1).

---

## Architecture Overview

SaveHub implements a **dual-channel synchronization strategy**: HTTP APIs handle mutations (commands), while WebSocket handles real-time subscriptions (queries). This follows CQRS principles and enables both optimistic updates and eventual consistency.

**Diagram: Real-time Synchronization Flow**

```mermaid
flowchart TB
    subgraph "Database Layer"
        PG[("PostgreSQL<br/>(Supabase)")]
        Triggers["Postgres Triggers<br/>NOTIFY on INSERT/UPDATE/DELETE"]
    end
    
    subgraph "Backend Layer"
        Forwarder["realtime_forwarder<br/>(SupabaseRealtimeForwarder)"]
        WSRouter["websocket.py<br/>/api/ws/realtime"]
        ConnMgr["connection_manager<br/>(ConnectionManager)"]
    end
    
    subgraph "Frontend Layer"
        WSClient["realtimeWSManager<br/>(WebSocket Client)"]
        Hook["useRealtimeSync()<br/>Hook"]
        Store["Zustand Store<br/>7 Slices"]
    end
    
    PG -->|"postgres_changes"| Triggers
    Triggers -->|"Supabase Realtime"| Forwarder
    Forwarder -->|"Broadcast"| ConnMgr
    ConnMgr -->|"JSON Messages"| WSRouter
    WSRouter <-->|"WebSocket Protocol"| WSClient
    WSClient -->|"Table-specific callbacks"| Hook
    Hook -->|"Update state"| Store
    
    User[("User Action")]
    User -->|"1. Optimistic Update"| Store
    Store -->|"2. HTTP API Call"| Backend["FastAPI Backend"]
    Backend -->|"3. DB Write"| PG
    PG -->|"4. Trigger NOTIFY"| Triggers
    
    OtherClient[("Other Clients")]
    ConnMgr -.->|"Broadcast to all"| OtherClient
```

**Sources:** [backend/app/main.py:25-40](), [backend/app/api/routers/websocket.py:64-121](), [frontend/hooks/use-realtime-sync.ts:1-124]()

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `realtime_forwarder` | `backend/app/services/supabase_realtime.py` | Subscribes to Supabase postgres_changes, broadcasts to WebSocket clients |
| `connection_manager` | `backend/app/services/realtime.py` | Manages active WebSocket connections, handles user-scoped broadcasting |
| `websocket.py` | `backend/app/api/routers/websocket.py` | WebSocket endpoint with cookie-based authentication |
| `realtimeWSManager` | `frontend/lib/realtime-ws.ts` | Frontend WebSocket client with reconnection logic |
| `useRealtimeSync()` | `frontend/hooks/use-realtime-sync.ts` | React hook that registers store update callbacks |

---

## Backend WebSocket Infrastructure

### Realtime Forwarder Service

The `realtime_forwarder` service is the bridge between Supabase's Postgres changes and the backend's WebSocket connections. It starts during application lifespan and runs continuously.

**Lifecycle Management:**

```mermaid
sequenceDiagram
    participant App as "FastAPI App"
    participant Forwarder as "realtime_forwarder"
    participant Supabase as "Supabase Realtime"
    participant ConnMgr as "connection_manager"
    
    App->>Forwarder: start() on app startup
    Forwarder->>Supabase: Subscribe to postgres_changes
    Note over Supabase: Channels: feeds, articles, folders
    
    loop Database Changes
        Supabase->>Forwarder: postgres_changes event
        Forwarder->>ConnMgr: Broadcast to connected users
        ConnMgr->>ConnMgr: Filter by user_id
        ConnMgr-->>Clients: Send JSON to matching connections
    end
    
    App->>Forwarder: stop() on app shutdown
    Forwarder->>Supabase: Unsubscribe & disconnect
```

**Sources:** [backend/app/main.py:29-40]()

The forwarder subscribes to three tables: `feeds`, `articles`, and `folders`. Each subscription receives `INSERT`, `UPDATE`, and `DELETE` events with the changed row data.

**Sources:** [backend/app/api/routers/websocket.py:70-84]()

### WebSocket Endpoint

The WebSocket endpoint at `/api/ws/realtime` provides the client-facing interface for real-time updates.

**Endpoint Definition:**

```mermaid
graph TB
    subgraph "websocket.py"
        Endpoint["/api/ws/realtime<br/>@router.websocket"]
        Auth["authenticate_websocket()<br/>Cookie: sb_access_token"]
        Accept["websocket.accept()"]
        Register["connection_manager.connect()"]
        Loop["Message Loop<br/>(ping/pong)"]
        Cleanup["connection_manager.disconnect()"]
    end
    
    Client["WebSocket Client"]
    
    Client -->|"1. Connect with cookies"| Endpoint
    Endpoint -->|"2. Extract token"| Auth
    Auth -->|"3. Verify with Supabase"| Verify["get_user(token)"]
    Verify -->|"4. If valid"| Accept
    Accept -->|"5. Register user_id"| Register
    Register -->|"6. Keep-alive"| Loop
    Loop -->|"On disconnect"| Cleanup
    
    Auth -.->|"If invalid"| Reject["close(4001, 'Unauthorized')"]
```

**Sources:** [backend/app/api/routers/websocket.py:64-121]()

**Authentication Flow:**

The WebSocket uses the same cookie-based authentication as HTTP endpoints:

1. Client connects with `sb_access_token` cookie
2. Server extracts token from `websocket.cookies.get(COOKIE_NAME_ACCESS)`
3. Token is validated using `client.auth.get_user(access_token)`
4. If valid, connection is accepted and registered with `user_id`
5. If invalid, connection is rejected with code `4001` (Unauthorized)

**Sources:** [backend/app/api/routers/websocket.py:30-61](), [backend/app/api/routers/websocket.py:21-22]()

### Connection Manager

The `connection_manager` service maintains a registry of active connections indexed by `user_id`, enabling user-scoped message broadcasting. This ensures clients only receive updates for their own data.

**Connection Registry Structure:**

```mermaid
classDiagram
    class ConnectionManager {
        +connections: Dict[str, List[WebSocket]]
        +connect(websocket, user_id)
        +disconnect(websocket, user_id)
        +broadcast_to_user(user_id, message)
        +broadcast_table_event(table, event, payload)
    }
    
    class WebSocket {
        +send_json(data)
        +receive_json()
        +close(code, reason)
    }
    
    ConnectionManager "1" --> "*" WebSocket : manages
    
    note for ConnectionManager "Filters broadcasts by user_id\nfrom postgres_changes payload"
```

**Sources:** [backend/app/api/routers/websocket.py:12]()

---

## Frontend WebSocket Client

### Connection Management

The frontend uses `realtimeWSManager` (defined in `frontend/lib/realtime-ws.ts`) to manage WebSocket connections with automatic reconnection logic.

**WebSocket Client Features:**

```mermaid
graph LR
    subgraph "realtimeWSManager"
        Connect["connect()"]
        Reconnect["Auto-reconnect<br/>on disconnect"]
        Subscribe["subscribeToFeeds()<br/>subscribeToArticles()<br/>subscribeToFolders()"]
        Unsubscribe["unsubscribeAll()"]
    end
    
    subgraph "Message Handling"
        Parse["Parse JSON"]
        Route["Route by table + event"]
        Callback["Execute callback"]
    end
    
    Connect --> Reconnect
    Subscribe --> Parse
    Parse --> Route
    Route --> Callback
    Callback --> Store["Update Zustand Store"]
```

**Connection Lifecycle:**

The connection is established when the component mounts and uses credentials from HttpOnly cookies automatically sent with the WebSocket handshake.

**Sources:** [frontend/hooks/use-realtime-sync.ts:11-12]()

### Subscription System

The `useRealtimeSync()` hook registers callbacks for each table type. These callbacks transform database rows into frontend types and update the store.

**Diagram: Subscription Registration**

```mermaid
sequenceDiagram
    participant Hook as "useRealtimeSync()"
    participant Manager as "realtimeWSManager"
    participant Store as "useRSSStore()"
    
    Hook->>Manager: subscribeToFeeds(onInsert, onUpdate, onDelete)
    Note over Manager: Register callbacks for 'feeds' table
    
    Hook->>Manager: subscribeToArticles(onInsert, onUpdate, onDelete)
    Note over Manager: Register callbacks for 'articles' table
    
    Hook->>Manager: subscribeToFolders(onInsert, onUpdate, onDelete)
    Note over Manager: Register callbacks for 'folders' table
    
    loop WebSocket Message
        Manager->>Manager: Parse message
        Manager->>Manager: Route by table + event
        Manager->>Hook: Execute callback(row_data)
        Hook->>Hook: Transform row (snake_case → camelCase)
        Hook->>Store: store.addFeed() / store.addArticles() / etc.
    end
```

**Sources:** [frontend/hooks/use-realtime-sync.ts:14-114]()

### Feed Subscription Example

**Insert Handler:**

```mermaid
flowchart LR
    WS["WebSocket Message"] --> Parse["Parse feedRow"]
    Parse --> Transform["Transform to Feed type"]
    Transform --> Call["store.addFeed(feed)"]
    Call --> Check{"Already exists?"}
    Check -->|No| Insert["Insert into store"]
    Check -->|Yes| Skip["Skip (log & ignore)"]
```

The insert handler transforms the database row format to the frontend `Feed` type:

- `feed_id` → `feedId`
- `folder_id` → `folderId`
- `unread_count` → `unreadCount`
- `refresh_interval` → `refreshInterval`
- `last_fetched` → `lastFetched` (Date object)
- `enable_deduplication` → `enableDeduplication`

**Sources:** [frontend/hooks/use-realtime-sync.ts:14-55]()

### Article Subscription Example

**Update Handler:**

Articles have special handling for updates because they need to merge with existing article state rather than replace it entirely. This preserves fields that may not be included in the update event.

```mermaid
flowchart TB
    Update["UPDATE event"] --> Find["Find existing article"]
    Find --> Exists{"Article exists?"}
    Exists -->|Yes| Merge["Merge updated fields<br/>(is_read, is_starred)"]
    Exists -->|No| Skip["Skip update"]
    Merge --> Store["store.addArticles([article])"]
```

**Sources:** [frontend/hooks/use-realtime-sync.ts:58-95]()

### Folder Subscription Example

Folder operations are simpler since folders have fewer fields and less complex state interactions:

- **INSERT**: `store.addFolder(folder)` 
- **UPDATE**: `store.renameFolder(id, name)`
- **DELETE**: `store.removeFolder(id)`

**Sources:** [frontend/hooks/use-realtime-sync.ts:98-114]()

---

## Message Protocol

### Message Format

All WebSocket messages are JSON with a consistent structure:

```json
{
  "type": "postgres_changes",
  "table": "feeds" | "articles" | "folders",
  "event": "INSERT" | "UPDATE" | "DELETE",
  "payload": {
    "new": { ...row_data } | null,
    "old": { ...row_data } | null
  }
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"postgres_changes"` | Message type identifier |
| `table` | `string` | Database table name |
| `event` | `string` | Database operation type |
| `payload.new` | `object \| null` | New row data (INSERT/UPDATE) |
| `payload.old` | `object \| null` | Old row data (UPDATE/DELETE) |

**Sources:** [backend/app/api/routers/websocket.py:75-84]()

### Event Types by Table

**Feeds Table:**

```mermaid
graph LR
    subgraph "INSERT"
        I1["payload.new contains:<br/>- id<br/>- title<br/>- url<br/>- folder_id<br/>- unread_count<br/>- etc."]
    end
    
    subgraph "UPDATE"
        U1["payload.new: updated fields<br/>payload.old: previous values"]
    end
    
    subgraph "DELETE"
        D1["payload.old: deleted row<br/>payload.new: null"]
    end
```

**Articles Table:**

The `articles` table events include computed fields like `repository_count` that join with the `article_repositories` table.

**Sources:** [frontend/hooks/use-realtime-sync.ts:73]()

**Folders Table:**

Folder events are simpler, containing only:
- `id` (string)
- `name` (string)
- `order` (number)
- `created_at` (ISO timestamp)

**Sources:** [frontend/hooks/use-realtime-sync.ts:98-114]()

### Heartbeat Protocol

Clients can send ping messages to verify connection health:

**Request:**
```json
{ "type": "ping" }
```

**Response:**
```json
{ "type": "pong" }
```

**Sources:** [backend/app/api/routers/websocket.py:108-109]()

---

## Connection Lifecycle

### Startup Sequence

```mermaid
sequenceDiagram
    participant App as "Next.js App"
    participant Hook as "useRealtimeSync()"
    participant Manager as "realtimeWSManager"
    participant WS as "WebSocket"
    participant Backend as "Backend /api/ws/realtime"
    
    App->>Hook: Component mount
    Note over Hook: useEffect with [] deps
    
    Hook->>Manager: subscribeToFeeds(callbacks)
    Hook->>Manager: subscribeToArticles(callbacks)
    Hook->>Manager: subscribeToFolders(callbacks)
    
    Manager->>WS: new WebSocket(url)
    Note over WS: Cookies auto-attached
    
    WS->>Backend: Connect handshake
    Backend->>Backend: authenticate_websocket()
    Backend-->>WS: Accept (101 Switching Protocols)
    
    Backend->>Manager: Connected
    Note over Manager: Ready to receive messages
```

**Sources:** [frontend/hooks/use-realtime-sync.ts:11-21]()

### Message Processing Flow

```mermaid
flowchart TB
    Receive["WebSocket.onmessage"] --> Parse["JSON.parse(data)"]
    Parse --> Type{"message.type"}
    
    Type -->|"postgres_changes"| Table{"message.table"}
    Type -->|"pong"| Ignore1["Ignore (heartbeat response)"]
    Type -->|"unknown"| Ignore2["Ignore (log warning)"]
    
    Table -->|"feeds"| Event1{"message.event"}
    Table -->|"articles"| Event2{"message.event"}
    Table -->|"folders"| Event3{"message.event"}
    
    Event1 -->|"INSERT"| CB1["onInsert callback"]
    Event1 -->|"UPDATE"| CB2["onUpdate callback"]
    Event1 -->|"DELETE"| CB3["onDelete callback"]
    
    Event2 -->|"INSERT"| CB4["onInsert callback"]
    Event2 -->|"UPDATE"| CB5["onUpdate callback"]
    Event2 -->|"DELETE"| CB6["onDelete callback"]
    
    Event3 -->|"INSERT"| CB7["onInsert callback"]
    Event3 -->|"UPDATE"| CB8["onUpdate callback"]
    Event3 -->|"DELETE"| CB9["onDelete callback"]
    
    CB1 --> Store["Update Zustand Store"]
    CB2 --> Store
    CB3 --> Store
    CB4 --> Store
    CB5 --> Store
    CB6 --> Store
    CB7 --> Store
    CB8 --> Store
    CB9 --> Store
```

**Sources:** [frontend/hooks/use-realtime-sync.ts:14-114]()

### Cleanup Sequence

```mermaid
sequenceDiagram
    participant App as "Next.js App"
    participant Hook as "useRealtimeSync()"
    participant Manager as "realtimeWSManager"
    participant WS as "WebSocket"
    participant Backend as "Backend"
    
    App->>Hook: Component unmount
    Hook->>Manager: unsubscribeAll()
    Manager->>Manager: Clear callback registry
    Manager->>WS: close()
    WS->>Backend: Close handshake
    Backend->>Backend: connection_manager.disconnect()
    Backend-->>WS: Connection closed
    
    Note over Hook: Cleanup complete
```

**Sources:** [frontend/hooks/use-realtime-sync.ts:116-120]()

---

## Synchronization Patterns

### Optimistic Updates

SaveHub uses **optimistic UI updates** for user-initiated actions, combined with WebSocket reconciliation for eventual consistency.

**Diagram: Optimistic Update Flow**

```mermaid
sequenceDiagram
    participant User
    participant UI as "React Component"
    participant Store as "Zustand Store"
    participant API as "HTTP API"
    participant DB as "Database"
    participant WS as "WebSocket"
    
    User->>UI: Mark article as read
    UI->>Store: updateArticle(id, {isRead: true})
    Note over Store: Immediate local update
    UI-->>User: UI updates instantly
    
    Store->>API: PATCH /api/articles/:id
    API->>DB: UPDATE articles SET is_read=true
    
    DB->>DB: Trigger NOTIFY
    DB->>WS: postgres_changes UPDATE event
    WS->>Store: Update event received
    Store->>Store: Merge with existing state
    
    Note over Store: State confirmed by server
```

**Example from Articles API:**

The `updateArticle` function in the store immediately updates local state, then calls the backend API. If the API call fails, the optimistic update remains (no rollback), but the WebSocket will reconcile state on the next update from any source.

**Sources:** [frontend/lib/api/articles.ts:185-207]()

### Multi-Client Consistency

When one client modifies data, all other connected clients receive the change via WebSocket:

```mermaid
sequenceDiagram
    participant C1 as "Client 1"
    participant API as "Backend API"
    participant DB as "Database"
    participant WS as "WebSocket Forwarder"
    participant C2 as "Client 2"
    participant C3 as "Client 3"
    
    C1->>API: DELETE /api/feeds/:id
    API->>DB: DELETE FROM feeds WHERE id=...
    DB->>DB: Trigger fires
    DB->>WS: DELETE event for feed
    
    WS->>WS: Filter by user_id
    
    par Broadcast to all clients
        WS->>C1: DELETE event
        WS->>C2: DELETE event
        WS->>C3: DELETE event
    end
    
    Note over C1,C3: All clients update stores
```

**Sources:** [backend/app/api/routers/websocket.py:70-84]()

### Rate Limiting and Deduplication

The frontend subscription handlers implement deduplication logic to handle race conditions:

1. **INSERT events** check if the item already exists before adding
2. **UPDATE events** merge changes with existing state
3. **DELETE events** use filter to safely remove even if already gone

**Example: Feed Insert Deduplication**

```mermaid
flowchart TB
    Insert["INSERT event received"] --> Call["store.addFeed(feed)"]
    Call --> Check{"Feed exists?"}
    Check -->|No| Add["Add to store.feeds[]"]
    Check -->|Yes| Log["Log: already exists<br/>result.success = false"]
    Log --> Skip["Skip insertion"]
    
    Note1["Prevents duplicates from:<br/>- Race conditions<br/>- Multiple broadcast sources<br/>- Network retries"]
```

**Sources:** [frontend/hooks/use-realtime-sync.ts:30-33]()

### Authentication Token Refresh

WebSocket connections use the same cookie-based authentication as HTTP requests. The `fetchWithAuth` client handles proactive token refresh, but WebSocket connections require special handling:

**Token Expiry Handling:**

1. WebSocket uses `sb_access_token` cookie for authentication
2. If cookie expires, WebSocket authentication will fail on reconnect
3. The `AuthProvider` runs proactive refresh every 5 minutes
4. On refresh, new cookie is set, and future WebSocket reconnections use updated token

**Sources:** [frontend/lib/context/auth-context.tsx:72-86](), [frontend/lib/api/fetch-client.ts:151-156]()

### Error Handling

**Connection Errors:**

When the WebSocket connection fails or is rejected:

```mermaid
flowchart TB
    Error["Connection Error"] --> Check{"Error Code?"}
    Check -->|"4001 (Unauthorized)"| Redirect["Redirect to /login"]
    Check -->|"Network error"| Retry["Auto-reconnect with backoff"]
    Check -->|"Other error"| Log["Log error + retry"]
    
    Retry --> Wait["Wait N seconds"]
    Wait --> Reconnect["Attempt reconnection"]
```

**Message Processing Errors:**

If a callback throws an error during message processing, the error is logged but other subscriptions continue processing:

```mermaid
flowchart LR
    Message["Message arrives"] --> Route["Route to callbacks"]
    Route --> Try["Try callback 1"]
    Try -->|Success| Next1["Try callback 2"]
    Try -->|Error| Catch["Catch + log error"]
    Catch --> Next2["Try callback 2"]
    Next1 --> Continue["Continue processing"]
    Next2 --> Continue
```

**Sources:** [backend/app/api/routers/websocket.py:111-117]()

---

## Integration Points

### HTTP API Integration

The real-time system complements HTTP APIs, creating a dual-channel pattern:

| Channel | Purpose | Examples |
|---------|---------|----------|
| **HTTP** | Commands (mutations) | Create feed, update article, delete folder |
| **WebSocket** | Queries (subscriptions) | Real-time updates, multi-client sync |

**Sources:** [frontend/lib/api/articles.ts](), [frontend/lib/api/feeds.ts](), [frontend/lib/api/folders.ts]()

### Zustand Store Integration

All WebSocket callbacks ultimately update the Zustand store through the same methods used by user actions, ensuring consistent state management:

**Store Methods Used:**

- `store.addFeed()` - Adds or updates feed
- `store.updateFeed()` - Partial update
- `store.removeFeed()` - Delete
- `store.addArticles()` - Batch upsert
- `store.addFolder()` - Add folder
- `store.renameFolder()` - Update folder name
- `store.removeFolder()` - Delete folder

**Sources:** [frontend/hooks/use-realtime-sync.ts:30-113]()

### Authentication Context Integration

The WebSocket authentication integrates with the `AuthProvider` context:

1. `AuthProvider` manages login/logout and token refresh
2. `setAuthFailureCallback()` registers logout handler
3. WebSocket receives HttpOnly cookies automatically
4. Failed WebSocket auth triggers the same logout flow as HTTP 401

**Sources:** [frontend/lib/context/auth-context.tsx:43-47]()