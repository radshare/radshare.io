import { Injectable } from '@angular/core';
import {Observable} from 'rxjs';
import {RadRoom} from './home/home.component';
import {HttpClient} from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class RelicService {

  constructor(private http: HttpClient) { }

  getRadshares(): Observable<any> {
    return this.http.get(`/api/home`);
  }

  newRoom(newRoom: RadRoom): Observable<any> {
    return this.http.post(`/api/home`, newRoom);
  }
}
