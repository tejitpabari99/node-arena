/** Auth slot (PRD Identity): default no-op accepts everyone. Room logic keys on `playerId` only. */
export interface Auth {
  verify(auth: string | undefined): { uid?: string } | null;
}

export const noopAuth: Auth = { verify: () => ({}) };
