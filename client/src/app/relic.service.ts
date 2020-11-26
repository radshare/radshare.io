import { Injectable } from '@angular/core';
import {Observable, of} from 'rxjs';
import {RadRoom} from './home/home.component';
import {HttpClient} from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class RelicService {

  constructor(private http: HttpClient) { }

  getRadshares(): Observable<any> {
    return of(null);
  }

  newRoom(newRoom: RadRoom): Observable<any> {
    this.http.post(`/api/home`, newRoom);
    return of();
  }
}
