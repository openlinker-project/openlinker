import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FieldError } from './field-error';

interface ControlProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  className?: string;
  id?: string;
}

/**
 * The wiring a `FormField` provides to its control: the id its label points at and the
 * `aria-*` attributes that tie the control to the field's description and error.
 */
export interface FormFieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

interface FormFieldContextValue {
  controlProps: FormFieldControlProps;
  // Set by `useFormFieldControl()` so a multi-child field can notice, in dev, that nothing
  // took its wiring. Kept out of `controlProps`, which callers spread onto a DOM element.
  consumed: MutableRefObject<boolean>;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

/**
 * Returns the props a control inside a `FormField` must carry, for the shapes where the
 * field cannot attach them itself (a fragment, an array, several controls on one row).
 *
 * Spread the result onto the ONE control the label and error belong to:
 *
 *   <FormField label="Amount" name="amount" error={error}>
 *     <>
 *       <Input {...useFormFieldControl()} />   // call the hook in a child component
 *       <span>PLN</span>
 *     </>
 *   </FormField>
 *
 * Outside a `FormField` it returns an empty object, so a control can use it unconditionally.
 */
export function useFormFieldControl(): FormFieldControlProps {
  const context = useContext(FormFieldContext);
  if (context === null) {
    return {};
  }
  context.consumed.current = true;
  return context.controlProps;
}

interface FormFieldProps {
  // A single form control element (Input, Select, Textarea, or a wrapper component) is
  // cloned with id, aria-describedby and aria-invalid, so it must forward them to its
  // underlying native element — a wrapper that does not silently breaks the wiring.
  //
  // Anything else (a fragment, an array, several siblings, a conditional that can be null)
  // is rendered as-is and nothing is cloned: the control that owns the label and error must
  // take its props from `useFormFieldControl()`.
  children: ReactNode;
  description?: ReactNode;
  error?: string;
  label: ReactNode;
  name: string;
}

export function FormField({ children, description, error, label, name }: FormFieldProps): ReactElement {
  const generatedId = useId();
  // Children.toArray drops null/undefined/boolean, so `{cond && <Input />}` counts as no child.
  const nodes = Children.toArray(children);
  const single = nodes.length === 1 ? nodes[0] : null;
  // A fragment is a valid element but not a control: cloning onto it would attach the props
  // to nothing, so it takes the same path as several children.
  const control =
    isValidElement<ControlProps>(single) && single.type !== Fragment ? single : null;

  const inputId = control?.props.id ?? `${name}-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy =
    [control?.props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ') ||
    undefined;
  const ariaInvalid = Boolean(error) || Boolean(control?.props['aria-invalid']);

  const controlProps: FormFieldControlProps = {
    id: inputId,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
  };

  const consumed = useRef(false);
  useEffect(() => {
    // The wiring is opt-in on the multi-child path, so a control that forgets the hook
    // renders fine yet carries no aria-invalid / aria-describedby. Only an error makes the
    // gap matter, and only a field that never consumed the context can be flagged.
    if (import.meta.env.DEV && control === null && error && !consumed.current) {
      console.warn(
        `FormField "${name}" has an error but no child called useFormFieldControl(); ` +
          'its control carries no aria-invalid / aria-describedby wiring.'
      );
    }
  }, [control, error, name]);

  return (
    <FormFieldContext.Provider value={{ controlProps, consumed }}>
      <div className="form-field">
        <label htmlFor={inputId} className="form-field__label">
          {label}
        </label>
        {control ? cloneElement(control, controlProps) : children}
        {description ? (
          <p id={descriptionId} className="form-field__description">
            {description}
          </p>
        ) : null}
        <FieldError id={errorId ?? `${inputId}-error`} message={error} />
      </div>
    </FormFieldContext.Provider>
  );
}
