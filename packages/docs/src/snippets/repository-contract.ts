// #region contract
// test/unit/store.spec.ts
import { createMemoryRepositories } from '@chamvi/core';
import { describeRepositoryContract } from '@chamvi/test-kit';

describeRepositoryContract((clock) => createMemoryRepositories({ clock }));
// #endregion contract
