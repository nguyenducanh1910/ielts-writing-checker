// Login (password, or an emailed link as a backup), sign up, the login-link callback and the privacy notice.
import { api, ApiClientError } from '../api';
import { h, replace } from '../dom';
import { navigate, type RouteContext } from '../router';
import { setSession, type SessionUser } from '../session';
import { getConfig } from '../state';
import {
  async,
  busy,
  errorBox,
  field,
  link,
  loading,
  notice,
  page,
  selectEl,
  showFieldErrors,
} from '../ui/components';
import { localTimeZone } from '../ui/format';

/** Log-in and sign-up pages sit in the middle of the screen. */
function centered(section: HTMLElement): HTMLElement {
  section.classList.add('page-centered');
  return section;
}

interface SessionResponse {
  sessionToken: string;
  user: SessionUser;
}

/** auth.login: a session, or (no password typed / account without one) a login link was emailed. */
type LoginResponse = SessionResponse | { linkSent: true; email: string; knownAccount?: boolean };

function enterSite(res: SessionResponse) {
  setSession(res.sessionToken, res.user);
  navigate(res.user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
}

function passwordInput(name: string, autocomplete: 'current-password' | 'new-password') {
  return h('input', { type: 'password', name, autocomplete, required: true, maxlength: '128' });
}

export function loginPage(ctx: RouteContext): Node {
  const expired = ctx.query.get('expired')
    ? notice('warning', 'Your session has ended. Please log in again.')
    : null;
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true });
  const password = passwordInput('password', 'current-password');
  const status = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Log in');
  const form = h(
    'form',
    { class: 'card narrow', novalidate: true },
    field({ label: 'Email address', control: email, name: 'email' }),
    field({
      label: 'Password',
      control: password,
      name: 'password',
      hint: 'No password yet? Leave it empty and press Log in: we will email you a login link.',
    }),
    submit,
    status,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    if (!email.value.trim()) errors.email = 'Enter your email address';
    showFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    void busy(submit, 'Logging in…', async () => {
      try {
        const res = await api<LoginResponse>('auth.login', {
          email: email.value,
          password: password.value,
        });
        if ('linkSent' in res) {
          password.value = '';
          replace(
            status,
            notice(
              'success',
              h(
                'p',
                null,
                res.knownAccount
                  ? `We sent a login link to ${res.email}. Open the email and click the link to log in.`
                  : `If ${res.email} has an account, a login link is on its way. Open the email and click the link to log in.`,
              ),
              h('p', null, 'If it is not in your inbox, check the Spam folder.'),
            ),
          );
          return;
        }
        enterSite(res);
      } catch (err) {
        if (err instanceof ApiClientError && err.fields) showFieldErrors(form, err.fields);
        replace(status, errorBox(err));
      }
    });
  });

  // Backup for a forgotten password: a one-time link to the same email address.
  const linkStatus = h('div', { 'aria-live': 'polite' });
  const linkBtn = h('button', { type: 'button', class: 'btn' }, 'Email me a login link');
  linkBtn.addEventListener('click', () => {
    if (!email.value.trim()) {
      showFieldErrors(form, { email: 'Enter your email address' });
      return;
    }
    showFieldErrors(form, {});
    void busy(linkBtn, 'Sending…', async () => {
      try {
        const res = await api<{ message: string }>('auth.requestLink', { email: email.value });
        replace(
          linkStatus,
          notice(
            'success',
            h('p', null, res.message),
            h('p', null, 'If it is not in your inbox, check the Spam folder.'),
          ),
        );
      } catch (err) {
        replace(linkStatus, errorBox(err));
      }
    });
  });
  const forgot = h(
    'details',
    { class: 'card narrow' },
    h('summary', null, 'Forgot your password?'),
    h(
      'p',
      null,
      'Ask your teacher to set a new one, or enter your email above and we will send you a one-time login link. You can then choose a new password in Settings.',
    ),
    linkBtn,
    linkStatus,
  );
  return centered(
    page(
      'Log in',
      expired,
      form,
      forgot,
      h('p', null, 'New here? ', link('/signup', 'Create an account'), '.'),
    ),
  );
}

export function signupPage(): Node {
  return centered(
    page(
      'Create an account',
      async(getConfig, (config) => {
        const name = h('input', {
          name: 'name',
          autocomplete: 'name',
          required: true,
          maxlength: '80',
        });
        const email = h('input', {
          type: 'email',
          name: 'email',
          autocomplete: 'email',
          required: true,
        });
        const password = passwordInput('password', 'new-password');
        const cls = selectEl(
          'classId',
          config.classes.map((c) => ({ value: c.id, label: c.label })),
          '',
          'Choose your class',
        );
        const consent = h('input', { type: 'checkbox', name: 'consent', id: 'consent' });
        const status = h('div', { 'aria-live': 'polite' });
        const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Sign up');
        const form = h(
          'form',
          { class: 'card narrow', novalidate: true },
          field({ label: 'Full name', control: name, name: 'name' }),
          field({ label: 'Email address', control: email, name: 'email' }),
          field({
            label: 'Choose a password',
            control: password,
            name: 'password',
            hint: 'At least 8 characters. You will use it with your email to log in.',
          }),
          field({ label: 'Class', control: cls, name: 'classId' }),
          h(
            'div',
            { class: 'field checkbox', dataset: { field: 'consent' } },
            consent,
            h(
              'label',
              { for: 'consent' },
              'I have read the ',
              link('/privacy', 'privacy notice', { target: '_blank' }),
              ' and agree that my essays and scores are stored in my teacher’s Google account.',
            ),
            h('p', { class: 'field-error', 'aria-live': 'polite' }),
          ),
          submit,
          status,
        );
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const errors: Record<string, string> = {};
          if (name.value.trim().length < 2) errors.name = 'Enter your full name';
          if (!email.value.trim()) errors.email = 'Enter your email address';
          if (password.value.length < 8) errors.password = 'Use at least 8 characters';
          if (!cls.value) errors.classId = 'Choose your class';
          if (!consent.checked) errors.consent = 'Please agree to the privacy notice to continue.';
          showFieldErrors(form, errors);
          if (Object.keys(errors).length) return;
          void busy(submit, 'Signing up…', async () => {
            try {
              enterSite(
                await api<SessionResponse>('auth.signup', {
                  name: name.value,
                  email: email.value,
                  password: password.value,
                  classId: cls.value,
                  consent: true,
                  timezone: localTimeZone(),
                }),
              );
            } catch (err) {
              if (err instanceof ApiClientError) showFieldErrors(form, err.fields);
              replace(status, errorBox(err));
            }
          });
        });
        return [form, h('p', null, 'Already registered? ', link('/login', 'Log in'), '.')];
      }),
    ),
  );
}

export function authCallbackPage(ctx: RouteContext): Node {
  const box = h('div', null, loading('Logging you in…'));
  const token = ctx.query.get('token') ?? '';
  // A link from IELTS Harper Portal may name the page to open, e.g. /essays/abc-123.
  const next = ctx.query.get('next') ?? '';
  // Remove the token from the address bar and history straight away.
  history.replaceState(null, '', '#/auth');
  api<{ sessionToken: string; user: SessionUser }>('auth.exchange', { token }).then(
    (res) => {
      setSession(res.sessionToken, res.user);
      const home = res.user.role === 'admin' ? '/admin' : '/dashboard';
      const safeNext = res.user.role === 'student' && /^\/[A-Za-z0-9/_-]{0,100}$/.test(next);
      navigate(safeNext ? next : home, { replace: true });
    },
    (err) => replace(box, errorBox(err), h('p', null, link('/login', 'Request a new login link'))),
  );
  return page('Logging in', box);
}

export function privacyPage(): Node {
  return page(
    'Privacy notice',
    h(
      'div',
      { class: 'card prose' },
      h('h2', null, 'What we store'),
      h(
        'p',
        null,
        'Your name, email, class, target band and exam date (if you add them), the essays you write, chart images you upload, your scores, feedback and the errors your teacher tags.',
      ),
      h('h2', null, 'Where it is stored'),
      h(
        'p',
        null,
        'Everything is stored in your teacher’s own Google account: a private Google Sheet and a private Google Drive folder. They are never shared publicly. Emails are sent from your teacher’s Gmail.',
      ),
      h('h2', null, 'Your choices'),
      h(
        'p',
        null,
        'You can update your details or delete your account at any time from Settings. Deleting your account removes your rows from the Sheet, moves your essay folders to the Drive trash and ends all your sessions.',
      ),
      h('h2', null, 'Login'),
      h(
        'p',
        null,
        'You log in with your email and password. Passwords are stored only as a salted hash, never as plain text. A login link sent by email works once and expires after 15 minutes. Your session is kept in this browser for 30 days or until you log out.',
      ),
    ),
  );
}
