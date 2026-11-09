/**
 * Password Input
 *
 * An `Input` with a show/hide toggle. The toggle has a fixed width and is
 * positioned with top/bottom rather than a transform, so it never moves when
 * pressed or when its label changes (#4029).
 *
 * @module features/auth/components/login-stage
 */
import { forwardRef, useState } from 'react';
import { Button } from '../../../../shared/ui/button';
import { Input, type InputProps } from '../../../../shared/ui/input';

interface PasswordInputProps extends Omit<InputProps, 'type'> {
  labels: { show: string; hide: string; showPw: string; hidePw: string };
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ labels, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <div className="password-input">
        <Input ref={ref} {...props} type={visible ? 'text' : 'password'} />
        <Button
          tone="ghost"
          className="button--sm password-input__toggle"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? labels.hidePw : labels.showPw}
        >
          {visible ? labels.hide : labels.show}
        </Button>
      </div>
    );
  }
);
