# Time-sensitive queries take `now` as an argument

/ Status: accepted

`get`, `has`, and `list` evaluate secret expiry, which is time-relative. They
take the current time as an explicit `now` argument — supplied by the client
facade as `Date.now()` — rather than calling `Date.now()` inside the query.

Convex query results are cached, keyed on (function, arguments). A secret
crossing its `expiresAt` is not a row mutation, so it does not invalidate a
cached result. If these queries called `Date.now()` internally, a cached
"not expired" verdict would be served indefinitely after the secret actually
expired. Passing `now` as an argument keeps the query a pure function of
(args, data): each distinct `now` is a distinct cache entry, so an expiry
verdict is never stale. The cost — `get`/`has` rarely hit the query cache — is
irrelevant, and arguably desirable, for a secret read.

Time-independent queries (`listEvents`, `isRotationComplete`) take no `now`.
Mutations (`put`, `update`, `cleanupSecrets`, `cleanupEvents`) call `Date.now()`
directly: mutations are not cached, so it is correct there.

**Future readers:** do not "simplify" the time-sensitive queries by calling
`Date.now()` internally — it reintroduces stale expiry verdicts.
