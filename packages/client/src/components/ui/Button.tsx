import type { ReactNode } from 'react';

/**
 * A button, and nothing else. `type="button"` is not a detail: inside a form,
 * a button without it submits, and a « Pourquoi ? » that submitted a form
 * would send something the protocol never meant to carry.
 */
export function Button(props: {
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly variant?: 'principal' | 'discret';
  readonly expanded?: boolean;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      className={`fr-bouton fr-bouton--${props.variant ?? 'principal'}`}
      onClick={props.onClick}
      disabled={props.disabled ?? false}
      {...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded })}
    >
      {props.children}
    </button>
  );
}
