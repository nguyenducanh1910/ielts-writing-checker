import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiActions } from '../../apps-script/src/aiScoring';
import { accountActions } from '../../apps-script/src/handlers/account';
import { adminActions } from '../../apps-script/src/handlers/admin';
import { adminUploadActions } from '../../apps-script/src/handlers/adminUpload';
import { assignmentActions } from '../../apps-script/src/handlers/assignments';
import { claudeSetupActions } from '../../apps-script/src/handlers/claudeSetup';
import { dashboardActions } from '../../apps-script/src/handlers/dashboard';
import { essayActions } from '../../apps-script/src/handlers/essays';
import { listActions } from '../../apps-script/src/handlers/lists';
import { portalImportActions } from '../../apps-script/src/handlers/portalImport';
import { scoringActions } from '../../apps-script/src/handlers/scoring';
import { api, RETRY_DELAYS_MS, RETRYABLE_ACTIONS } from '../../src/api';

vi.mock('../../src/config', () => ({
  API_URL: 'https://example.test/exec',
  CLASSROOM_API_URL: '',
}));

const serverActions = {
  ...accountActions,
  ...essayActions,
  ...assignmentActions,
  ...adminActions,
  ...adminUploadActions,
  ...portalImportActions,
  ...listActions,
  ...claudeSetupActions,
  ...scoringActions,
  ...dashboardActions,
  ...aiActions,
};

const ok = () => new Response(JSON.stringify({ ok: true, data: { fine: true } }));

describe('retrying when the connection drops', () => {
  RETRY_DELAYS_MS.splice(0, RETRY_DELAYS_MS.length, 1, 1);
  afterEach(() => vi.unstubAllGlobals());

  it('only retries actions the server marks read-only', () => {
    for (const name of RETRYABLE_ACTIONS) {
      expect(serverActions[name as keyof typeof serverActions], name).toBeDefined();
      expect(serverActions[name as keyof typeof serverActions].write, name).toBe(false);
    }
    expect(RETRYABLE_ACTIONS.has('essays.listMine')).toBe(true);
    expect(RETRYABLE_ACTIONS.has('essays.get')).toBe(true);
    expect(RETRYABLE_ACTIONS.has('essays.submit')).toBe(false);
  });

  it('loads the essay list after a dropped request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('essays.listMine')).resolves.toEqual({ fine: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the last retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('essays.get', { id: 'x' })).rejects.toMatchObject({ code: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never repeats a submission', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api('essays.submit', {})).rejects.toMatchObject({ code: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
