/**
 * Every way a request to an outside service can fail, told apart so the user is
 * never shown the wrong reason - "no signal" when the service is actually down,
 * or "try again" when the request itself is broken.
 */
export type ServiceProblem =
  /** The browser reports no network connection at all. */
  | 'offline'
  /** Online, but the request never got an answer: weak signal, a blocked
   *  request, or the service down - the browser doesn't say which. */
  | 'unreachable'
  /** HTTP 429: the service is rate-limiting requests. */
  | 'busy'
  /** HTTP 5xx: the service is up but failing. */
  | 'down'
  /** Any other HTTP error: the service turned the request down - an app bug. */
  | 'refused'
  /** An answer came back but not in the shape the app expects. */
  | 'unreadable';

/** Why a request failed, in the user's words - a lowercase clause that reads after "Couldn't ...: ". */
export function describeProblem(service: string, problem: ServiceProblem, status?: number): string {
  switch (problem) {
    case 'offline':
      return 'no internet connection';
    case 'unreachable':
      return `couldn't reach ${service} - the signal may be weak, or ${service} may be down`;
    case 'busy':
      return `${service} is getting too many requests right now - try again in a few minutes`;
    case 'down':
      return `${service} isn't working right now (error ${status}) - try again later`;
    case 'refused':
      return `${service} turned the request down (error ${status}) - please report it through Guide/About`;
    case 'unreadable':
      return `${service} sent back something the app couldn't read`;
  }
}

/** An error whose message is already written for the user - `describeError` shows it as it is. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export class ServiceError extends UserFacingError {
  readonly problem: ServiceProblem;
  readonly status?: number;

  constructor(service: string, problem: ServiceProblem, status?: number) {
    super(describeProblem(service, problem, status));
    this.name = 'ServiceError';
    this.problem = problem;
    this.status = status;
  }
}

/** The problem an HTTP error status stands for. */
function problemForStatus(status: number): ServiceProblem {
  if (status === 429) return 'busy';
  if (status >= 500) return 'down';
  return 'refused';
}

/**
 * `fetch`, but every failure - no connection, no answer, an error status -
 * becomes a `ServiceError` saying which, named after `service` ("Open-Meteo").
 * Pass `allowStatus` for statuses the caller handles itself (e.g. 404).
 */
export async function fetchFrom(service: string, url: string, init?: RequestInit, allowStatus: number[] = []): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ServiceError(service, typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unreachable');
  }
  if (!res.ok && !allowStatus.includes(res.status)) throw new ServiceError(service, problemForStatus(res.status), res.status);
  return res;
}

/** The body as JSON, or a `ServiceError` if it isn't JSON. */
export async function readJson<T>(service: string, res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new ServiceError(service, 'unreadable');
  }
}

/**
 * Any error as a reason for the user. A `UserFacingError` (every `ServiceError`)
 * already says what went wrong; anything else is a fault inside the app, so it
 * must not be blamed on the connection.
 */
export function describeError(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  const detail = err instanceof Error ? err.message : String(err);
  return `something went wrong inside the app (${detail})`;
}
