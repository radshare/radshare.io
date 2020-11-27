import { Injectable } from '@angular/core';
import {Observable, of} from 'rxjs';
import {RadRoom} from './home/home.component';
import {HttpClient} from '@angular/common/http';
import {map} from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class RelicService {

  constructor(private http: HttpClient) { }

  getRadshares(): Observable<any> {
    return of(null);
  }

  newRoom(newRoom: RadRoom): Observable<any> {
    console.log(newRoom);
    return this.http.post(`/api/home`, newRoom).pipe(
      map((room : RadRoom) => {
        console.log(room);
        return room;
      })
    );
  }
}
