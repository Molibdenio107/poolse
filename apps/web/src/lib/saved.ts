'use client';

import { useActionState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { visibleDetail } from '@/components/feedback';
import { undoArchive } from '@/app/(app)/dashboard/arquivados/archive.actions';
import { useBusyWhile } from './busy';

/**
 * `useActionState`, and then the screen actually shows the save — round 5.
 *
 * **The bug this removes.** A server action calls `revalidatePath`, which marks
 * the route stale on the server. What it does not always do is re-render the
 * page the operator is looking at: the action was dispatched from a client
 * component, the router keeps the RSC payload it already has, and the card the
 * form sits in goes on showing what it showed before. Saving a student's notes
 * and watching the record beside the form stay on yesterday's answer is the
 * report; every card in this app has the same shape and so had the same bug.
 *
 * `router.refresh()` is what asks for the new payload. It is called once per
 * successful dispatch — `useActionState` hands back a new state object each
 * time, so comparing identity fires exactly once and never loops, because the
 * refresh itself does not produce a new state.
 *
 * A failed save refreshes nothing: the server has the old data and the operator
 * has a correction to make in the form in front of them.
 *
 * Use it anywhere `useActionState` was used with a `FormState`. The signature is
 * deliberately identical, so the change at a call site is the name and nothing
 * else.
 *
 * ---------------------------------------------------------------------------
 * It also says so — round 7
 * ---------------------------------------------------------------------------
 *
 * The same comparison that decides whether to refresh decides when to raise a
 * toast, because they are the same moment: a result has come back that this
 * component has not reacted to yet. Doing it here rather than at 82 call sites
 * is the point — a form cannot forget, and there is one answer to "what does a
 * save look like".
 *
 * **Field errors are not toasted.** A refusal that named the boxes it refused is
 * already drawn beside each of them, and a message at the top of the screen
 * cannot say which of a dozen fields it meant. Those get the generic sentence or
 * nothing; the marker on the field is the useful half.
 */
export function useSavedAction<State extends { ok?: boolean }, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
): [state: Awaited<State>, dispatch: (payload: Payload) => void, isPending: boolean] {
  const [state, dispatch, isPending] = useActionState(action, initialState, permalink);
  // The corner's "A guardar…" for every form that saves — POOLSE-98.
  useBusyWhile(isPending, 'save');
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations();
  const offerUndo = useArchiveUndo();

  // The state object this component has already acted on. Identity, not a
  // boolean: `ok` stays true across renders, and a boolean would refresh on
  // every one of them.
  const acted = useRef<unknown>(state);

  useEffect(() => {
    if (acted.current === state) return;
    acted.current = state;

    if (state.ok === true) {
      const done = state as { undo?: string; redirectTo?: string };
      // A success that removed this page goes where the action said; the
      // toast lives above the route, so it survives the navigation.
      if (done.redirectTo !== undefined) router.push(done.redirectTo);
      else router.refresh();

      const message = successMessage(t, state);
      if (done.undo !== undefined) offerUndo(done.undo, message);
      else toast.show('success', message);
      return;
    }

    const message = failureMessage(t, state);
    if (message !== null) toast.show('danger', message);
  }, [state, router, toast, t, offerUndo]);

  return [state, dispatch, isPending];
}

type Translator = ReturnType<typeof useTranslations>;

/**
 * An action may name its own sentence — "Restaurado: Piscina 1" — and falls
 * back to the one every save says.
 */
function successMessage(t: Translator, state: unknown): string {
  const done = state as { toastKey?: string; values?: Record<string, string | number> };
  try {
    return done.toastKey === undefined
      ? t('common.savedToast')
      : t(done.toastKey as never, done.values as never);
  } catch {
    return t('common.savedToast');
  }
}

/**
 * What a refusal says, or null when there is nothing to say.
 *
 * Nothing at all for a plain `ok: false` with no reason. Several actions return
 * that as "I did not run" rather than "I failed" — an import wizard's initial
 * state, a dispatch the guard turned away before it reached the server. A toast
 * saying something went wrong when nothing was attempted is worse than silence.
 */
function failureMessage(t: Translator, state: unknown): string | null {
  const failed = state as {
    ok?: boolean;
    errorKey?: string;
    detail?: string;
    fields?: unknown;
    values?: Record<string, string | number>;
  };
  if (failed.ok !== false) return null;
  if (failed.errorKey === undefined && failed.fields === undefined) return null;

  /*
   * The key the form would have printed, and the server's own words after it
   * where there are any — the same shape the calendar's refusals use, so a
   * lane clash reads "Essa pista já está ocupada — Pista 5 · Masters" here too.
   *
   * `t` refuses an unknown key by throwing, and a refusal nobody planned for
   * must not take the page down with it: the generic sentence is the fallback.
   */
  let message: string;
  try {
    message =
      failed.errorKey === undefined
        ? t('common.checkTheFields')
        : // With the refusal's own figures — a key with placeholders and no
          // values throws, and fell through to the generic sentence below.
          t(failed.errorKey as never, failed.values as never);
  } catch {
    message = t('common.notSaved');
  }

  // Never the API's own words — `visibleDetail` says which shapes and why.
  const detail = visibleDetail(failed.detail);
  return detail === null ? message : `${message} — ${detail}`;
}

/**
 * The success toast of an archive, carrying *Anular* — POOLSE-78.
 *
 * *Anular* calls the bin's own restore with the action's audit entry, so there
 * is one way back and the toast cannot drift from the bin. Its outcome is a
 * second toast: "Restaurado: …", or the refusal as a sentence (a name taken in
 * the seconds since is still a name taken).
 *
 * Exported for the one archive that does not go through `useSavedAction`, the
 * space header's dialog.
 */
export function useArchiveUndo(): (entryId: string, message: string) => void {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations();

  return useCallback(
    (entryId: string, message: string) => {
      toast.show('success', message, {
        label: t('common.undo'),
        onAct: () => {
          void undoArchive(entryId).then(
            (result) => {
              if (result.ok) {
                router.refresh();
                toast.show('success', successMessage(t, result));
              } else {
                toast.show('danger', failureMessage(t, result) ?? t('archive.restoreFailed'));
              }
            },
            () => toast.show('danger', t('archive.restoreFailed')),
          );
        },
      });
    },
    [router, toast, t],
  );
}
