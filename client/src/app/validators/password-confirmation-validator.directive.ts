import { NG_VALIDATORS, Validator, FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import {Attribute, Directive} from '@angular/core';

@Directive({
  selector: '[passwordConfValidator][ngModel]',
  providers: [
    {
      provide: NG_VALIDATORS,
      useClass: PasswordConfirmationValidator,
      multi: true
    }
  ]
})
export class PasswordConfirmationValidator implements Validator {

  constructor(@Attribute('passwordConfValidator') public PasswordControl: string) { }

  validate(c: FormControl) {

    const Password = c.root.get(this.PasswordControl);
    const ConfirmPassword = c;

    if (ConfirmPassword.value === null) {
      return null;
    }

    if (Password) {
      const subscription: Subscription = Password.valueChanges.subscribe(() => {
        ConfirmPassword.updateValueAndValidity();
        subscription.unsubscribe();
      });
    }
    return Password && Password.value !== ConfirmPassword.value ? { passwordMatchError: true } : null;
  }

}
