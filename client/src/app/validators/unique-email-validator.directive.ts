import { Directive } from '@angular/core';
import {AbstractControl, AsyncValidator, NG_ASYNC_VALIDATORS, ValidationErrors} from '@angular/forms';
import {Observable, of} from 'rxjs';
import {UserService} from '../services/user.service';
import {map} from 'rxjs/operators';

@Directive({
  selector: '[UniqueEmail]',
  providers: [
    {
      provide: NG_ASYNC_VALIDATORS,
      useClass: UniqueEmailValidator,
      multi: true
    }
  ]
})
export class UniqueEmailValidator implements AsyncValidator {

  constructor(private userService: UserService) { }

  validate(c: AbstractControl): Observable<ValidationErrors | null> {
    if (!c.value){
      return of(null);
    }
    else{
      return this.userService.checkEmail(c.value).pipe(
        map(isValid => {
          return isValid ? {takenEmail: true} : null;
        })
      );
    }
  }
}
