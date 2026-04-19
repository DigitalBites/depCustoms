const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

export function getValidUuidParam(
  value: string | null | undefined,
): string | null {
  if (!value || !UUID_PATTERN.test(value)) {
    return null;
  }

  return value;
}

export function getValidPathSegmentParam(
  value: string | null | undefined,
): string | null {
  if (!value || !PATH_SEGMENT_PATTERN.test(value)) {
    return null;
  }

  return value;
}
