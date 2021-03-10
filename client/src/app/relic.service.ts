import { Injectable } from '@angular/core';
import {Observable} from 'rxjs';
import {RadRoom} from './home/home.component';
import {HttpClient} from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class RelicService {
  private token: string;

  constructor(private http: HttpClient) { }

  private getToken(): string {
    if (!this.token) {
      this.token = localStorage.getItem("mean-token");
    }
    return this.token;
  }

  getRadshares(): Observable<any> {
    return this.http.get(`/api/home`);
  }

  newRoom(newRoom: RadRoom): Observable<any> {
    return this.http.post(`/api/home`, newRoom);
  }

  joinRoom(roomID: string): Observable<any> {
    console.log('Joining room...');
    return this.http.put('/api/room', roomID, {
      headers: {Authorization: `Bearer ${this.getToken()}`}
    });
  }
}
