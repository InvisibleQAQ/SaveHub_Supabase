
# Authentication & Security

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



## Purpose and Scope

This document covers authentication mechanisms, token management, and security features in the SaveHub application. Topics include JWT-based authentication, automatic token refresh, WebSocket authentication, and security protections.

For state management and API client layer details, see [State Management](#4.1) and [API Client Layer](#4.5). For real-time synchronization security, see [Real-time Synchronization](#3.2).

---

## Authentication Architecture

SaveHub uses **Supabase Auth** for JWT-based authentication with HttpOnly cookies for secure token storage. The system implements automatic token refresh with mutex protection to prevent race conditions.

### Authentication Flow Overview

```mermaid
graph TB
    subgraph "Client (Browser)"
        LoginForm["Login Form"]
        AuthProvider["AuthProvider<br/>(auth-context.tsx)"]
        FetchClient["fetchWithAuth<br/>(fetch-client.ts)"]
        Cookies["HttpOnly Cookies<br/>sb_access_token<br/>sb_refresh_token"]
    end
    
    subgraph "Backend (FastAPI)"
        AuthRouter["auth.router<br/>/api/auth/*"]
        JWTVerify["verify_jwt<br/>dependency"]
        APIEndpoints["Protected API<br/>Endpoints"]
    end
    
    subgraph "Supabase"
        SupabaseAuth["Supabase Auth<br/>JWT Issuer"]
    end
    
    LoginForm -->|"1. POST /auth/login"| AuthRouter
    AuthRouter -->|"2. Authenticate"| SupabaseAuth
    SupabaseAuth -->|"3. JWT tokens"| AuthRouter
    AuthRouter -->|"4. Set HttpOnly cookies"| Cookies
    Cookies -->|"5. Include in requests"| FetchClient
    FetchClient -->|"6. Automatic credential include"| APIEndpoints
    APIEndpoints -->|"7. Verify JWT"| JWTVerify
    JWTVerify -->|"8. Extract user_id"| APIEndpoints
    
    FetchClient -->|"401 detected"| RefreshFlow["Token Refresh Flow"]
    RefreshFlow -->|"POST /auth/refresh"| AuthRouter
```

**Sources:** [backend/app/main.py:59-76](), [frontend/lib/context/auth-context.tsx:1-142](), [frontend/lib/api/fetch-client.ts:1-239]()

---

## Frontend Authentication

### AuthProvider and Context

The `AuthProvider` component manages authentication state and provides authentication methods to the application.

#### AuthContext Structure

| Field | Type | Purpose |
|-------|------|---------|
| `user` | `AuthUser \| null` | Current authenticated user |
| `isLoading` | `boolean` | Initial session check status |
| `isAuthenticated` | `boolean` | Derived from user presence |
| `login` | `(email, password) => Promise<void>` | Login method |
| `register` | `(email, password) => Promise<void>` | Registration method |
| `logout` | `() => Promise<void>` | Logout method |
| `refreshSession` | `() => Promise<boolean>` | Manual session refresh |

**Sources:** [frontend/lib/context/auth-context.tsx:21-29]()

#### Initialization Flow

```mermaid
sequenceDiagram
    participant App
    participant AuthProvider
    participant authApi
    participant fetchClient
    participant Backend
    
    App->>AuthProvider: Mount component
    AuthProvider->>authApi: getSession()
    authApi->>Backend: GET /api/auth/session
    Backend-->>authApi: session data
    
    alt Session Valid
        authApi-->>AuthProvider: { authenticated: true, user }
        AuthProvider->>fetchClient: setTokenExpiry(3600)
        AuthProvider->>AuthProvider: setUser(user)
    else Session Invalid
        authApi-->>AuthProvider: { authenticated: false }
        AuthProvider->>AuthProvider: setUser(null)
    end
    
    AuthProvider->>fetchClient: setAuthFailureCallback()
    AuthProvider->>App: Render children
    
    Note over AuthProvider: Start proactive refresh<br/>every 5 minutes
```

**Sources:** [frontend/lib/context/auth-context.tsx:43-86]()

### Token Storage (HttpOnly Cookies)

Tokens are stored in **HttpOnly cookies** for security, preventing JavaScript access and XSS attacks.

#### Cookie Configuration

| Cookie Name | Content | Properties |
|-------------|---------|------------|
| `sb_access_token` | JWT access token | HttpOnly, Secure (production), SameSite |
| `sb_refresh_token` | JWT refresh token | HttpOnly, Secure (production), SameSite |

These cookies are:
- Set by backend auth endpoints: `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`
- Automatically included in all API requests via `credentials: "include"`
- Cleared on logout: `/api/auth/logout`

**Sources:** [backend/app/api/routers/websocket.py:22]()

---

## Automatic Token Refresh

The `fetchWithAuth` client implements automatic token refresh with mutex protection to handle concurrent requests.

### Token Refresh State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    
    Idle --> ProactiveCheck: Request initiated
    ProactiveCheck --> RefreshNeeded: Token expiring soon?
    ProactiveCheck --> MakeRequest: Token valid
    
    RefreshNeeded --> Refreshing: doRefresh()
    Refreshing --> Refreshing: Concurrent requests wait
    Refreshing --> MakeRequest: Success
    Refreshing --> AuthFailure: Failure
    
    MakeRequest --> [*]: 200 OK
    MakeRequest --> ReactiveRefresh: 401 Unauthorized
    
    ReactiveRefresh --> Refreshing: doRefresh()
    
    AuthFailure --> RedirectLogin: onAuthFailure()
    RedirectLogin --> [*]
```

**Sources:** [frontend/lib/api/fetch-client.ts:115-165]()

### Refresh Logic Implementation

The refresh mechanism uses a **mutex lock** to ensure only one refresh happens at a time.

#### Key State Variables

```typescript
interface RefreshState {
  isRefreshing: boolean
  refreshPromise: Promise<boolean> | null
}

// Token expiry tracking
let tokenExpiresAt: number | null = null

// Buffer time: refresh 5 minutes before expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000
```

**Sources:** [frontend/lib/api/fetch-client.ts:16-56]()

#### doRefresh() Function

```mermaid
flowchart TD
    Start["doRefresh() called"]
    CheckRefreshing{"isRefreshing?"}
    WaitPromise["Wait for existing<br/>refreshPromise"]
    SetRefreshing["Set isRefreshing = true"]
    CreatePromise["Create new refreshPromise"]
    
    CallAPI["POST /api/backend/auth/refresh"]
    CheckResponse{"Response OK?"}
    UpdateExpiry["setTokenExpiry(3600)"]
    ReturnTrue["Return true"]
    ReturnFalse["Return false"]
    Finally["Finally: reset state"]
    
    Start --> CheckRefreshing
    CheckRefreshing -->|Yes| WaitPromise
    CheckRefreshing -->|No| SetRefreshing
    WaitPromise --> End
    SetRefreshing --> CreatePromise
    CreatePromise --> CallAPI
    CallAPI --> CheckResponse
    CheckResponse -->|200 OK| UpdateExpiry
    CheckResponse -->|Error| ReturnFalse
    UpdateExpiry --> ReturnTrue
    ReturnTrue --> Finally
    ReturnFalse --> Finally
    Finally --> End["End"]
```

**Sources:** [frontend/lib/api/fetch-client.ts:115-144]()

### Proactive vs Reactive Refresh

| Refresh Type | Trigger | Purpose |
|--------------|---------|---------|
| **Proactive** | Token expiring within 5 minutes | Prevent 401 errors before they happen |
| **Reactive** | 401 response received | Recover from expired token |
| **Manual** | User action via `refreshSession()` | Support explicit refresh UI |

#### Proactive Refresh Schedule

The `AuthProvider` runs proactive refresh every 5 minutes when user is authenticated:

**Sources:** [frontend/lib/context/auth-context.tsx:73-86]()

---

## Backend Authentication

### JWT Verification Dependency

Backend routes use a `verify_jwt` dependency to authenticate requests. This dependency:
1. Extracts JWT from `sb_access_token` cookie
2. Validates token with Supabase
3. Returns `user_id` for use in route handlers

**Note:** The actual `verify_jwt` implementation is in `backend/app/api/dependencies/auth.py` (not provided in files).

### WebSocket Authentication

WebSocket connections authenticate via cookie **before** accepting the connection.

#### WebSocket Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant WSEndpoint as "/api/ws/realtime"
    participant AuthFunc as "authenticate_websocket()"
    participant Supabase
    participant ConnMgr as "connection_manager"
    
    Client->>WSEndpoint: WebSocket handshake<br/>(cookies included)
    WSEndpoint->>AuthFunc: Check cookies
    AuthFunc->>AuthFunc: Extract sb_access_token
    
    alt Token Present
        AuthFunc->>Supabase: auth.get_user(token)
        Supabase-->>AuthFunc: user object
        AuthFunc-->>WSEndpoint: user_id
        WSEndpoint->>Client: accept()
        WSEndpoint->>ConnMgr: connect(ws, user_id)
        ConnMgr-->>Client: Connected
    else No Token / Invalid
        AuthFunc-->>WSEndpoint: None
        WSEndpoint->>Client: close(4001, "Unauthorized")
    end
```

**Sources:** [backend/app/api/routers/websocket.py:30-61](), [backend/app/api/routers/websocket.py:64-122]()

#### WebSocket Authentication Implementation

```python
async def authenticate_websocket(websocket: WebSocket) -> str | None:
    # Get access token from cookie (available before accept())
    access_token = websocket.cookies.get(COOKIE_NAME_ACCESS)
    
    if not access_token:
        return None
    
    try:
        client = get_supabase_client()
        user_response = client.auth.get_user(access_token)
        return user_response.user.id if user_response.user else None
    except Exception:
        return None
```

**Sources:** [backend/app/api/routers/websocket.py:30-61]()

---

## Security Features

### CORS Configuration

The FastAPI backend configures CORS middleware to control cross-origin access.

#### CORS Settings

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Production Considerations:**
- Replace `allow_origins=["*"]` with specific frontend domains
- Enable `allow_credentials=True` required for HttpOnly cookies
- Restrict methods/headers if needed

**Sources:** [backend/app/main.py:50-56]()

### API Key Encryption

API configurations (OpenAI, DeepSeek, etc.) store encrypted API keys in the database.

#### API Config Security

| Feature | Implementation |
|---------|----------------|
| Storage | `api_configs` table with encrypted `api_key` field |
| Encryption | Backend-side encryption (implementation in service layer) |
| Access Control | User-scoped via `user_id` foreign key |
| Validation | `validateApiConfig()` validates without storing keys |

**Sources:** [frontend/lib/api/api-configs.ts:1-221](), [frontend/lib/api-validation.ts:1-127]()

### SSRF Protection

The image proxy endpoint implements SSRF (Server-Side Request Forgery) protection when fetching external images.

**Note:** SSRF protection details are in the image proxy implementation, which validates URLs and restricts access to internal networks. See [Articles Management](#5.1) for image proxy details.

### Request Authentication Chain

All authenticated API requests follow this chain:

```mermaid
graph LR
    Request["HTTP Request"]
    FetchWithAuth["fetchWithAuth<br/>client"]
    ProactiveCheck["Proactive<br/>Expiry Check"]
    IncludeCreds["Include<br/>credentials"]
    BackendRoute["Backend<br/>Route Handler"]
    VerifyJWT["verify_jwt<br/>dependency"]
    UserScope["User-scoped<br/>Operation"]
    
    Request --> FetchWithAuth
    FetchWithAuth --> ProactiveCheck
    ProactiveCheck --> IncludeCreds
    IncludeCreds --> BackendRoute
    BackendRoute --> VerifyJWT
    VerifyJWT --> UserScope
    
    ProactiveCheck -.->|"Token expiring"| Refresh["Token Refresh"]
    Refresh -.-> IncludeCreds
    
    BackendRoute -.->|"401"| ReactiveRefresh["Reactive Refresh"]
    ReactiveRefresh -.-> IncludeCreds
```

**Sources:** [frontend/lib/api/fetch-client.ts:185-238]()

---

## URL Skip List

Certain URLs bypass authentication handling to prevent refresh loops:

```typescript
const SKIP_AUTH_URLS = [
  "/api/backend/auth/login",
  "/api/backend/auth/register",
  "/api/backend/auth/refresh",
  "/api/backend/auth/logout",
  "/api/backend/auth/session",
]
```

These endpoints are excluded from:
- Proactive token refresh checks
- Reactive 401 handling
- Automatic retry logic

**Sources:** [frontend/lib/api/fetch-client.ts:28-34]()

---

## Authentication Methods

### Login Flow

```mermaid
sequenceDiagram
    participant User
    participant LoginForm
    participant AuthProvider
    participant authApi
    participant Backend
    participant Supabase
    participant Router
    
    User->>LoginForm: Enter credentials
    LoginForm->>AuthProvider: login(email, password)
    AuthProvider->>authApi: login(email, password)
    authApi->>Backend: POST /api/auth/login
    Backend->>Supabase: signInWithPassword()
    Supabase-->>Backend: session + user
    Backend->>Backend: Set HttpOnly cookies
    Backend-->>authApi: authUser object
    authApi-->>AuthProvider: authUser
    AuthProvider->>AuthProvider: setUser(authUser)
    AuthProvider->>AuthProvider: setTokenExpiry(3600)
    AuthProvider->>Router: push("/all")
    AuthProvider->>Router: refresh()
    Router-->>User: Navigate to /all
```

**Sources:** [frontend/lib/context/auth-context.tsx:88-94]()

### Logout Flow

```mermaid
sequenceDiagram
    participant User
    participant AuthProvider
    participant authApi
    participant Backend
    participant Router
    
    User->>AuthProvider: logout()
    AuthProvider->>authApi: logout()
    authApi->>Backend: POST /api/auth/logout
    Backend->>Backend: Clear HttpOnly cookies
    Backend-->>authApi: success
    authApi-->>AuthProvider: void
    AuthProvider->>AuthProvider: setUser(null)
    AuthProvider->>AuthProvider: clearTokenExpiry()
    AuthProvider->>Router: push("/login")
    AuthProvider->>Router: refresh()
    Router-->>User: Navigate to /login
```

**Sources:** [frontend/lib/context/auth-context.tsx:104-110]()

### Registration Flow

Registration follows the same pattern as login, but calls `/api/auth/register` endpoint instead.

**Sources:** [frontend/lib/context/auth-context.tsx:96-102]()

---

## Token Expiry Management

### Token Expiry State

The fetch client tracks token expiry to enable proactive refresh:

```typescript
// Set after successful login/refresh
setTokenExpiry(expiresInSeconds: number): void

// Clear on logout
clearTokenExpiry(): void

// Check if refresh needed
isTokenExpiringSoon(): boolean
```

**Token Validity:** Supabase default is 3600 seconds (1 hour).

**Buffer:** System refreshes 5 minutes (300 seconds) before expiry.

**Sources:** [frontend/lib/api/fetch-client.ts:74-98]()

### Expiry Timeline

```mermaid
gantt
    title Token Lifecycle (1 hour validity)
    dateFormat X
    axisFormat %M min
    
    section Token
    Valid token            :0, 3300000
    Refresh buffer (5 min) :3300000, 300000
    Expired                :3600000, 300000
    
    section Actions
    Proactive refresh triggered :milestone, 3300000, 0
    Reactive refresh (401)      :milestone, 3600000, 0
```

---

## Session Persistence

Sessions persist across browser restarts through:
1. **HttpOnly cookies** stored by browser
2. **Session check on mount** in AuthProvider
3. **Automatic refresh** if token valid but expiring

### Session Check on Application Load

```typescript
useEffect(() => {
  const checkSession = async () => {
    try {
      const session = await authApi.getSession()
      if (session.authenticated && session.user) {
        setUser(session.user)
        setTokenExpiry(3600)  // Initialize expiry tracking
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }
  
  checkSession()
}, [])
```

**Sources:** [frontend/lib/context/auth-context.tsx:51-70]()

---

## Error Handling

### Authentication Failure Callback

The fetch client calls `onAuthFailure()` when refresh fails:

```typescript
setAuthFailureCallback(() => {
  setUser(null)
  router.push("/login")
})
```

This callback is set by AuthProvider and triggers:
1. User state cleared
2. Navigation to login page

**Sources:** [frontend/lib/context/auth-context.tsx:43-48](), [frontend/lib/api/fetch-client.ts:66-68]()

### 401 Handling

When a request returns 401:
1. `fetchWithAuth` attempts token refresh
2. If refresh succeeds, request is retried once
3. If refresh fails, `onAuthFailure()` is called

**Sources:** [frontend/lib/api/fetch-client.ts:221-235]()

---

## Integration with API Clients

All API client modules use `fetchWithAuth` for automatic authentication:

```typescript
// Example: articles.ts
const response = await fetchWithAuth(API_BASE, {
  method: "GET",
})
```

This provides:
- Automatic `credentials: "include"` 
- Proactive token refresh
- Reactive 401 handling
- Transparent retry after refresh

**Sources:** [frontend/lib/api/articles.ts:130-132](), [frontend/lib/api/feeds.ts:94-96](), [frontend/lib/api/folders.ts:63-65](), [frontend/lib/api/settings.ts:66-68](), [frontend/lib/api/api-configs.ts:83-85]()