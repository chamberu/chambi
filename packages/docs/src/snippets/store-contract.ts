// #region contract
// test/unit/store.spec.ts
import { createMemoryStores } from '@chamvi/core';
import { describeStoreContract } from '@chamvi/test-kit';

describeStoreContract((clock) => createMemoryStores({ clock }));
// #endregion contract
