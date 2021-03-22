import { Injectable } from '@angular/core';
import {Observable} from 'rxjs';
import {RadRoom} from './home/home.component';
import {HttpClient} from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class RelicService {
  private token: string;
  private registeredRoomID: string;

  constructor(private http: HttpClient) { }

  setRegisteredRoomID(value: string) {
    this.registeredRoomID = value;
  }

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
    return this.http.post(`/api/home`, newRoom, {
      headers: {Authorization: `Bearer ${this.getToken()}`}
    });
  }

  joinRoom(roomID: string): Observable<any> {
    return this.http.put('/api/room', {id: roomID},
      {headers: {Authorization: `Bearer ${this.getToken()}`}
    });
  }

  loadRoomDetails(): Observable<any> {
    return this.http.get(('/api/room/' + this.registeredRoomID),
      {headers: {Authorization: `Bearer ${this.getToken()}`}
    });
  }
}
