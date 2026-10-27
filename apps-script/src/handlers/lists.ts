// Admin-editable lists: error categories, topics, classes, feedback sources, settings.
import { CRITERIA, DEFAULT_SETTINGS, LIMITS } from '../../../shared/constants';
import { ApiError, bool, type Ctx, getSetting } from '../context';
import type { ActionDef } from '../router';
import type { TableName } from '../schema';
import { Reader } from '../validate';

function lists(ctx: Ctx) {
  return {
    categories: ctx.db.all('ErrorCategories').map((c) => ({
      id: c.id,
      criterion: c.criterion,
      label: c.label,
      active: bool(c.active),
    })),
    topics: ctx.db.all('Topics').map((t) => ({ id: t.id, label: t.label, active: bool(t.active) })),
    classes: ctx.db
      .all('Classes')
      .map((c) => ({ id: c.id, label: c.label, active: bool(c.active) })),
    sources: ctx.db
      .all('FeedbackSources')
      .map((s) => ({ id: s.id, name: s.name, active: bool(s.active) })),
    settings: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, getSetting(ctx, k)])),
  };
}

/** Add or update a row in a simple {id, label|name, active} list, keeping labels unique. */
function saveSimple(
  ctx: Ctx,
  table: 'Topics' | 'Classes' | 'FeedbackSources' | 'ErrorCategories',
  labelKey: 'label' | 'name',
  payload: unknown,
  extra: (r: Reader) => Record<string, string> = () => ({}),
) {
  const r = new Reader(payload);
  const id = r.id('id', true);
  const label = r.str(labelKey, { max: LIMITS.label, min: 1 });
  const active = r.has('active') ? r.bool('active') : true;
  const more = extra(r);
  r.done();
  const rows = ctx.db.all(table as TableName) as Array<Record<string, string>>;
  const clash = rows.find(
    (x) => x.id !== id && (x[labelKey] ?? '').trim().toLowerCase() === label.toLowerCase(),
  );
  if (clash)
    throw new ApiError('conflict', `"${label}" already exists.`, { [labelKey]: 'Already exists' });
  if (id) {
    if (!rows.some((x) => x.id === id)) throw new ApiError('not_found', 'Not found.');
    ctx.db.update(table, (x) => (x as { id: string }).id === id, {
      [labelKey]: label,
      active,
      ...more,
    });
    return { id };
  }
  const newId = ctx.svc.uuid();
  ctx.db.insert(table, { id: newId, [labelKey]: label, active, ...more });
  return { id: newId };
}

function saveSettings(ctx: Ctx, payload: unknown) {
  const r = new Reader(payload);
  const cap = r.int('daily_submission_cap', { min: 1, max: 50 });
  const tz = r.timezone('admin_timezone');
  const reserve = r.int('email_quota_reserve', { min: 0, max: 90 });
  if (!tz) r.addError('admin_timezone', 'Required');
  r.done();
  const values: Record<string, string> = {
    daily_submission_cap: String(cap),
    admin_timezone: tz,
    email_quota_reserve: String(reserve),
  };
  for (const [key, value] of Object.entries(values)) {
    if (ctx.db.findOne('Settings', (s) => s.key === key)) {
      ctx.db.update('Settings', (s) => s.key === key, { value });
    } else {
      ctx.db.insert('Settings', { key, value });
    }
  }
  return values;
}

export const listActions: Record<string, ActionDef> = {
  'admin.lists': { write: false, handler: (ctx) => lists(ctx) },
  'admin.categories.save': {
    write: true,
    handler: (ctx, p) =>
      saveSimple(ctx, 'ErrorCategories', 'label', p, (r) => ({
        criterion: r.oneOf('criterion', CRITERIA) as string,
      })),
  },
  'admin.topics.save': { write: true, handler: (ctx, p) => saveSimple(ctx, 'Topics', 'label', p) },
  'admin.classes.save': {
    write: true,
    handler: (ctx, p) => saveSimple(ctx, 'Classes', 'label', p),
  },
  'admin.sources.save': {
    write: true,
    handler: (ctx, p) => saveSimple(ctx, 'FeedbackSources', 'name', p),
  },
  'admin.settings.save': { write: true, handler: (ctx, p) => saveSettings(ctx, p) },
};
