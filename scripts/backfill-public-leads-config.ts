const DEFAULT_TARGET_ADDITIONAL_LEADS = 250;
const DEFAULT_CANDIDATE_POOL = 1400;
const DEFAULT_COMPANY_OFFSET = 0;

function readPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function resolveBackfillOptions() {
  return {
    targetAdditionalLeads: readPositiveInteger(
      process.env.YC_TARGET_ADDITIONAL_LEADS,
      DEFAULT_TARGET_ADDITIONAL_LEADS,
    ),
    candidatePool: readPositiveInteger(process.env.YC_CANDIDATE_POOL, DEFAULT_CANDIDATE_POOL),
    companyOffset: readPositiveInteger(process.env.YC_COMPANY_OFFSET, DEFAULT_COMPANY_OFFSET),
  };
}
