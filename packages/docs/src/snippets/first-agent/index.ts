// #region dashboard
// src/index.ts: the default app plus the dashboard at /ui
import { createApp } from '@chamvi/app';
import { uiModule } from '@chamvi/ui/module';

export default createApp({ modules: [uiModule()] });
// #endregion dashboard
