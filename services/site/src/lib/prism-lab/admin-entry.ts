import { isPrismLabEnabled } from "./feature-flag"

/** Only promote the bare entry. Legacy query URLs carry form state and feedback. */
export function shouldRedirectAdminToLab(
  params: Record<string, string | string[] | undefined>,
  labEnabled: string | undefined,
  labDefault: string | undefined,
) {
  return isPrismLabEnabled(labEnabled) && isPrismLabEnabled(labDefault)
    && Object.keys(params).length === 0
}

export const legacyAdminHref = "/admin?legacy=true"
