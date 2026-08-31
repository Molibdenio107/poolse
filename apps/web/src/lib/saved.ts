'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

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
 */
export function useSavedAction<State extends { ok?: boolean }, Payload>(
  action: (state: Awaited<State>, payload: Payload) => State | Promise<State>,
  initialState: Awaited<State>,
  permalink?: string,
): [state: Awaited<State>, dispatch: (payload: Payload) => void, isPending: boolean] {
  const [state, dispatch, isPending] = useActionState(action, initialState, permalink);
  const router = useRouter();

  // The state object this component has already acted on. Identity, not a
  // boolean: `ok` stays true across renders, and a boolean would refresh on
  // every one of them.
  const acted = useRef<unknown>(state);

  useEffect(() => {
    if (acted.current === state) return;
    acted.current = state;
    if (state.ok === true) router.refresh();
  }, [state, router]);

  return [state, dispatch, isPending];
}
