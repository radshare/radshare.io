import { Directive } from '@angular/core';
import {AbstractControl, NG_VALIDATORS, ValidationErrors, Validator} from '@angular/forms';

@Directive({
  selector: '[Whitespace]',
  providers: [
    {
      provide: NG_VALIDATORS,
      useClass: WhitespaceValidator,
      multi: true
    }
  ]
})
export class WhitespaceValidator implements Validator{

  constructor() { }


  validate(c: AbstractControl): ValidationErrors | null {
    if (!c.value){
      return null;
    }
    return c.value.includes(' ') ? {whiteSpace: true} : null;
  }

}
