import { useCallback, useState } from "react";
import { getUserErrorMessage } from "@/lib/api-error";

type MutationSuccess<T> = [T] extends [void]
  ? { ok: true }
  : { ok: true; data: T };

type MutationFailure = { ok: false; error: string };

export type ManagedMutationResult<T> = MutationSuccess<T> | MutationFailure;

export function useMutation<Args extends unknown[], T>(
  action: (...args: Args) => Promise<T>,
  errorPrefix: string,
) {
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (...args: Args): Promise<ManagedMutationResult<T>> => {
      setPending(true);
      try {
        const data = await action(...args);
        if (data === undefined) {
          return { ok: true } as MutationSuccess<T>;
        }
        return { ok: true, data } as MutationSuccess<T>;
      } catch (err) {
        return {
          ok: false,
          error: getUserErrorMessage(err, errorPrefix),
        };
      } finally {
        setPending(false);
      }
    },
    [action, errorPrefix],
  );

  return {
    pending,
    run,
  };
}
