// Single access-control function. Every API action calls authorize() before
// touching data: once at the action level (resource undefined) in the router,
// and again with the loaded resource inside handlers.
import type { AuthUser } from './auth';
import { ApiError, type EssayRow } from './context';
import type { Row } from './schema';

export type Resource =
  | { type: 'essay'; essay: EssayRow }
  /** Score, error log and rewrite request of an essay. */
  | { type: 'score' | 'errors' | 'rewrite'; essay: EssayRow }
  /** Admin-only tables: Claude drafts, external tool feedback, samples, email log. */
  | { type: 'draft' | 'source_feedback' | 'calibration_sample' | 'email_event' }
  | { type: 'user'; userId: string }
  | { type: 'image'; essay: EssayRow }
  | { type: 'assignment'; assignment: Row<'Assignments'>; eligible: boolean };

/** Actions anyone may call, signed in or not. */
export const PUBLIC_ACTIONS = new Set([
  'config.get',
  'auth.signup',
  'auth.login',
  'auth.requestLink',
  'auth.exchange',
  // Server-to-server from IELTS Harper Portal; checks its own shared secret.
  'portal.essays.import',
  'portal.signin',
]);

/** Actions for any signed-in user (students and admins). */
export const USER_ACTIONS = new Set([
  'auth.logout',
  'me.get',
  'me.update',
  'me.setPassword',
  'me.delete',
  'essays.listMine',
  'essays.get',
  'essays.saveDraft',
  'essays.startTest',
  'essays.submit',
  'essays.deleteDraft',
  'essays.image',
  'assignments.mine',
  'assignments.start',
  'dashboard.get',
  'topics.history',
]);

/** Access an action-level check grants. Admin-only actions start with "admin.". */
export function isAdminAction(action: string): boolean {
  return action.startsWith('admin.');
}

function deny(message = 'You do not have access to this.'): never {
  throw new ApiError('forbidden', message);
}

/** Throws ApiError when the user may not perform the action on the resource. */
export function authorize(action: string, user: AuthUser | null, resource?: Resource): void {
  if (!resource) {
    if (PUBLIC_ACTIONS.has(action)) return;
    if (!user) throw new ApiError('unauthenticated', 'Please log in again.');
    if (user.role === 'admin') return;
    if (isAdminAction(action) || !USER_ACTIONS.has(action)) deny();
    return;
  }

  if (!user) throw new ApiError('unauthenticated', 'Please log in again.');
  if (user.role === 'admin') return;

  // Student rules from here on.
  switch (resource.type) {
    case 'essay': {
      const own = resource.essay.student_id === user.id;
      if (!own) deny();
      if (action === 'essays.get' || action === 'essays.listMine' || action === 'essays.image')
        return;
      // Changing or deleting an essay is only allowed while it is a draft.
      if (
        action === 'essays.saveDraft' ||
        action === 'essays.submit' ||
        action === 'essays.deleteDraft'
      ) {
        if (resource.essay.status !== 'draft') deny('This essay has been submitted and is locked.');
        return;
      }
      if (action === 'essays.rewrite') {
        if (resource.essay.status !== 'scored') deny();
        return;
      }
      return deny();
    }
    case 'image':
      if (resource.essay.student_id !== user.id) deny();
      return;
    case 'score':
    case 'errors':
    case 'rewrite':
      // Students read their own results only once the final score is submitted.
      if (resource.essay.student_id !== user.id) deny();
      if (resource.essay.status !== 'scored') deny();
      if (action.startsWith('admin.')) deny();
      if (!/\.(get|listMine|read)$|^dashboard\.|^topics\./.test(action)) deny();
      return;
    case 'draft':
    case 'source_feedback':
    case 'calibration_sample':
    case 'email_event':
      return deny();
    case 'user':
      if (resource.userId !== user.id) deny();
      return;
    case 'assignment':
      if (!resource.eligible) deny();
      return;
  }
}

/** Boolean form for UI decisions and tests. */
export function can(action: string, user: AuthUser | null, resource?: Resource): boolean {
  try {
    authorize(action, user, resource);
    return true;
  } catch {
    return false;
  }
}
