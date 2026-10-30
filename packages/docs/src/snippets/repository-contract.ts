// #region contract
// test/unit/store.spec.ts
import { createMemoryStore } from '@chamvi/core';
import { describeRepositoryContract } from '@chamvi/test-kit';

describeRepositoryContract((clock) => createMemoryStore({ clock }));
// #endregion contract
