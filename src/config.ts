// The Apps Script web app URL. Public by design; there are no secrets in the front end.
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';

// The class management system (Google Classroom checker, its own Apps Script web app).
// Empty: the "Lớp học" section is hidden.
export const CLASSROOM_API_URL: string =
  (import.meta.env.VITE_CLASSROOM_API_URL as string | undefined)?.trim() ?? '';
