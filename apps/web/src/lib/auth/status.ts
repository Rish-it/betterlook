export type ChatGPTIssue =
  | 'consent-denied'
  | 'expired'
  | 'revoked'
  | 'refresh-failed'
  | 'provider-unavailable'
  | 'sign-in-failed'
  | 'revocation-unconfirmed'
  | 'not-configured';

export type ChatGPTStatus =
  | {status: 'signed-out'; available: boolean; issue?: ChatGPTIssue}
  | {status: 'signed-in'; account: string; planEnabled: boolean; issue?: ChatGPTIssue};
