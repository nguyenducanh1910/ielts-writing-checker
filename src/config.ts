// The Apps Script web app URL. Public by design; there are no secrets in the front end.
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? '';
