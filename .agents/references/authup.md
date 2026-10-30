# Reference: Authup repository conventions

- Source inspected: local `/opt/projects/authup/authup`, commit `a2b39a8ac` (2026-10-29).
- `packages/server-kit/src/core/types.ts`: `IEntityRepository` groups entity queries and mutations behind repository contracts.
- `apps/server-core/src/core/entities/user/types.ts`: `IUserRepository` adds domain operations.
- `apps/server-core/src/app/modules/database/repositories/user/repository.ts`: `UserRepositoryAdapter` adapts the persistence implementation to the contract.
- chamvi mapping: `packages/core/src/repository/types.ts` contains role-specific contracts; `packages/core/src/repository/memory/` and `packages/store-db/src/` implement them; `Engine.store` receives the assembled capabilities.

The user's requested `find`/`findOne`/`findOrFail`/`findOneOrFail` naming is explicit. It is not a claim that Authup exposes that exact quartet: the inspected generic Authup contract uses `findMany`, `findOneById` and other qualified methods. chamvi retains its existing domain return shapes, absence as undefined, mutation atomicity and clock semantics. No generic ORM query language or adapter inheritance hierarchy was introduced.
