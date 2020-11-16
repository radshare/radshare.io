import { Injectable } from '@angular/core';
import {Observable, of} from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class RelicService {

  constructor() { }

  getRadshares(): Observable<any> {
    return of(null);

  }
}
