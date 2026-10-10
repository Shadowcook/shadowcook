# Feature ideas

Short feature ideas collected during development. Implemented or approved architecture details belong in [ARCHITECTURE.md](ARCHITECTURE.md).

| Feature | Description | Architecture reference |
| --- | --- | --- |
| Cookbook update subscriptions | Followers receive an automatic summary of recipe publications since the previous delivery. The cookbook owner enables following and selects an administrator-limited delivery interval. | [35.5 Cookbook update subscriptions](ARCHITECTURE.md#355-cookbook-update-subscriptions) |
| Tenant slug reservation policy | Instance administrators manage additional exact reserved tenant slugs and contained blocked terms. The server rejects reserved values consistently during cookbook URL preview, registration, and cookbook creation. Fixed system-route slugs are always reserved. | — |
